"""Offline correctness and safety checks. No Firebase project is contacted."""

from copy import deepcopy
from dataclasses import replace
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from threading import Event
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from edash_provision.cli import command_for, main
from edash_provision.codec import SERVER_TIMESTAMP, encode_document, encode_value, make_write
from edash_provision.deployment import OutputRedactor, deploy, display_command, redact_output
from edash_provision.firestore import FirestoreClient, provision_documents
from edash_provision.models import ASSETS, Cancelled, Options, ProvisionError
from edash_provision.runner import run_plan
from edash_provision.validation import prepare_plan, read_json, validate_registration, validate_service_account


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="edash-provision-test-")
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.options = Options("tenant", "sample-tenant", ASSETS / "tenant-structure.json")

    def write(self, value, name="input.json"):
        path = self.folder / name
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def registration(self):
        data, _ = read_json(ASSETS / "school-registration.example.json")
        data["firebaseConfig"].update(apiKey="public-web-key", messagingSenderId="123456789", appId="1:123456789:web:abc")
        return data

    def response(self, value, status=200):
        return Mock(ok=status < 400, status_code=status, json=Mock(return_value=value))

    def client(self, responses):
        session = Mock()
        session.request.side_effect = responses
        return FirestoreClient(self.options.project, session, Event()), session

    def test_default_manifest_covers_current_tenant_settings(self):
        plan = prepare_plan(self.options)
        docs = {doc.path: doc.data for doc in plan.documents}
        self.assertEqual(len(docs), 9)
        self.assertIn("schoolYears/2026-2027", docs)
        self.assertEqual(docs["settings/toggles"]["trashConfg"], "30")
        self.assertEqual(docs["settings/cardPrintingPreferences"]["activeTemplate"], "sf9")
        self.assertEqual(docs["settings/gradeTerms/years/2026-2027"]["termCount"], 3)
        self.assertEqual(docs["settings/eduai"]["roleDefaults"]["Teacher"]["learnerNameLimit"], 0)
        self.assertFalse(any("learners/" in path or "teachers/" in path for path in docs))
        self.assertTrue(plan.collection_paths)

    def test_optional_admin_has_complete_workspace_preferences(self):
        plan = prepare_plan(replace(self.options, admin_uid="existing-admin", admin_email="admin@example.test"))
        profile = next(doc.data for doc in plan.documents if doc.path == "users/existing-admin")
        defaults, _ = read_json(ASSETS / "user-preferences.json")
        self.assertEqual(profile["teacherPrefs"], defaults)
        self.assertEqual(defaults["landingPage"], "dashboard.html")
        self.assertEqual(defaults["hiddenLearnerColumns"], [])
        self.assertTrue(defaults["photoCacheEnabled"])
        self.assertFalse(defaults["privacyMode"])
        self.assertEqual(profile["role"], "School Admin")

    def test_custom_user_structure_fills_preference_defaults_without_losing_choices(self):
        source = self.write({"format": "edash-tenant-provision", "version": 1, "documents": [
            {"path": "users/teacher-1", "data": {"role": "Teacher", "teacherPrefs": {"theme": "Forest", "inspectLearner": False}}}
        ]})
        profile = prepare_plan(replace(self.options, source=source)).documents[0].data
        defaults, _ = read_json(ASSETS / "user-preferences.json")
        self.assertEqual(profile["teacherPrefs"], {**defaults, "theme": "Forest", "inspectLearner": False})

    def test_dry_run_never_authenticates_or_discovers_cli(self):
        plan = prepare_plan(replace(self.options, deploy_rules=True, deploy_indexes=True))
        log = []
        with patch("edash_provision.runner.authorized_session") as auth, patch("edash_provision.runner.firebase_command") as cli:
            run_plan(plan, dry_run=True, log=log.append)
        auth.assert_not_called()
        cli.assert_not_called()
        self.assertIn("DRY RUN COMPLETE", log[-1])
        self.assertIsNotNone(plan.rules)

    def test_custom_structure_substitutes_year_and_retains_json_types(self):
        source = self.write({"format": "edash-tenant-provision", "version": 1, "documents": [{"path": "schoolYears/${schoolYear}/grades/grade-1", "data": {"schoolYear": "${schoolYear}", "subjects": ["english"], "enabled": True, "score": None}}]})
        plan = prepare_plan(replace(self.options, source=source, school_year="2027-2028"))
        self.assertEqual(plan.documents[0].path, "schoolYears/2027-2028/grades/grade-1")
        self.assertEqual(plan.documents[0].data["schoolYear"], "2027-2028")
        self.assertIs(plan.documents[0].data["enabled"], True)

    def test_invalid_project_and_year_fail_locally(self):
        for project in ("abc", "Wrong-project", "sample-tenant;calc", "sample/tenant", "-sample-tenant"):
            with self.subTest(project=project), self.assertRaises(ProvisionError):
                prepare_plan(replace(self.options, project=project))
        for year in ("2026-2028", "2026/2027", "year"):
            with self.subTest(year=year), self.assertRaises(ProvisionError):
                prepare_plan(replace(self.options, school_year=year))

    def test_rejects_duplicate_json_keys_and_nonfinite_numbers(self):
        path = self.folder / "bad.json"
        for raw in ('{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}'):
            path.write_text(raw, encoding="utf-8")
            with self.subTest(raw=raw), self.assertRaises(ProvisionError):
                read_json(path)

    def test_changed_source_is_rejected_before_authentication(self):
        plan = prepare_plan(self.options)
        with self.assertRaisesRegex(ProvisionError, "changed after review"):
            prepare_plan(self.options, "0" * 64)
        self.assertEqual(len(plan.source_hash), 64)

    def test_invalid_custom_structures_and_paths_do_not_build_writes(self):
        base = {"format": "edash-tenant-provision", "version": 1, "documents": [{"path": "settings/custom", "data": {"x": 1}}]}
        mutations = [
            {**base, "version": True}, {**base, "documents": []},
            {**base, "documents": base["documents"] * 2},
            {**base, "documents": [{"path": "settings/custom", "data": {}, "delete": True}]},
            {**base, "documents": [{"path": "../bad", "data": {}}]},
            {**base, "documents": [{"path": "settings", "data": {}}]},
            {**base, "documents": [{"path": "settings//nested/doc", "data": {}}]},
            {**base, "documents": [{"path": "settings/${unknown}", "data": {}}]},
            {**base, "documents": [{"path": "settings/custom", "data": {"nested": {"private_key": "hidden"}}}]},
        ]
        for index, data in enumerate(mutations):
            with self.subTest(index=index), self.assertRaises(ProvisionError):
                prepare_plan(replace(self.options, source=self.write(data)))

    def test_registration_forces_enabled_and_uses_field_masks_for_nested_merge(self):
        data = self.registration()
        data.update(enabled=False, custom={"keep": [1, 2], "empty": {}})
        doc = validate_registration(data, "central-registry")
        self.assertEqual(doc.path, "schools/sample-elementary")
        self.assertIs(doc.data["enabled"], True)
        self.assertNotIn("id", doc.data)
        write = make_write("central-registry", doc.path, doc.data, merge=True)
        mask = write["updateMask"]["fieldPaths"]
        self.assertIn("firebaseConfig.projectId", mask)
        self.assertNotIn("firebaseConfig", mask)
        self.assertNotIn("custom.empty", mask)
        self.assertIn("custom.keep", mask)
        self.assertNotIn("currentDocument", write)
        self.assertIn({"fieldPath": "schoolHead.updatedAt", "setToServerValue": "REQUEST_TIME"}, write["updateTransforms"])

    def test_registration_rejects_private_keys_placeholders_and_wrong_target(self):
        data = self.registration()
        with self.assertRaises(ProvisionError):
            validate_registration({**data, "private_key": "must-not-be-written"}, "central-registry")
        with self.assertRaises(ProvisionError):
            validate_registration(read_json(ASSETS / "school-registration.example.json")[0], "central-registry")
        with self.assertRaises(ProvisionError):
            validate_registration(data, "sample-school")
        for url in ("http://insecure.example/image.png", "//remote.example/image.png", "javascript:alert(1)"):
            with self.subTest(url=url), self.assertRaises(ProvisionError):
                validate_registration({**data, "logoUrl": url}, "central-registry")

    def test_service_key_project_and_token_endpoint_are_checked_offline(self):
        key = {"type": "service_account", "project_id": "sample-tenant", "client_email": "operator@sample-tenant.iam.gserviceaccount.com", "private_key": "-----BEGIN PRIVATE KEY-----\nnot-real\n-----END PRIVATE KEY-----", "token_uri": "https://oauth2.googleapis.com/token"}
        self.assertEqual(validate_service_account(self.write(key), "sample-tenant")["project_id"], "sample-tenant")
        with self.assertRaises(ProvisionError):
            validate_service_account(self.write(key), "central-registry")
        with self.assertRaises(ProvisionError):
            validate_service_account(self.write({**key, "token_uri": "https://untrusted.example/token"}), "sample-tenant")

    def test_codec_types_timestamp_masks_and_quoted_field_names(self):
        fields, mask, transforms = encode_document({"flag": False, "count": 1, "score": 2.5, "nothing": None, "a.b": {"quoted`key": "value"}, "updatedAt": SERVER_TIMESTAMP})
        self.assertEqual(fields["flag"], {"booleanValue": False})
        self.assertEqual(fields["count"], {"integerValue": "1"})
        self.assertIn("`a.b`.`quoted\\`key`", mask)
        self.assertEqual(transforms, [{"fieldPath": "updatedAt", "setToServerValue": "REQUEST_TIME"}])
        for value in (2**64, float("inf"), [[1]], [SERVER_TIMESTAMP]):
            with self.subTest(value=value), self.assertRaises(ProvisionError):
                encode_value(value)
        for marker in ({"$serverTimestamp": 1}, {"$serverTimestamp": False}, {"$serverTimestamp": True, "extra": "value"}):
            with self.subTest(marker=marker), self.assertRaises(ProvisionError):
                encode_document({"createdAt": marker})

    def test_bundled_asset_integrity(self):
        provenance, _ = read_json(ASSETS / "provenance.json")
        for name, expected in provenance["sha256"].items():
            with self.subTest(asset=name):
                self.assertEqual(hashlib.sha256((ASSETS / name).read_bytes()).hexdigest(), expected)

    def test_google_commit_conflicts_are_not_retried_or_overwritten(self):
        client, session = self.client([self.response({}, 409)])
        with self.assertRaisesRegex(ProvisionError, "atomic document commit was rejected"):
            client.commit([make_write("sample-tenant", "settings/custom", {"enabled": True})])
        self.assertEqual(session.request.call_count, 1)

    def test_batch_reads_must_account_for_every_requested_document(self):
        prefix = "projects/sample-tenant/databases/(default)/documents/"
        client, session = self.client([self.response([{"found": {"name": prefix + "settings/custom", "fields": {}}}, {"missing": prefix + "settings/new"}])])
        result = client.existing(["settings/custom", "settings/new"])
        self.assertIsNotNone(result["settings/custom"])
        self.assertIsNone(result["settings/new"])
        self.assertEqual(session.request.call_args.kwargs["timeout"], (10, 45))
        client, _ = self.client([self.response([])])
        with self.assertRaises(ProvisionError):
            client.existing(["settings/new"])

    def test_tenant_creates_missing_only_and_preserves_existing_current_year(self):
        plan = prepare_plan(self.options)
        snapshots = {doc.path: None for doc in plan.documents}
        snapshots["settings/currentSchoolYear"] = {"fields": {"value": {"stringValue": "2025-2026"}}}
        snapshots["settings/toggles"] = {"fields": {"canParentAccess": {"booleanValue": False}}}
        client = Mock(cancel=Event())
        client.existing.return_value = snapshots
        original = deepcopy(plan.documents[0].data)
        created, skipped = provision_documents(plan, client, lambda _: None)
        self.assertEqual((created, skipped), (7, 2))
        writes = client.commit.call_args.args[0]
        names = [write["update"]["name"] for write in writes]
        self.assertFalse(any(name.endswith("settings/toggles") for name in names))
        self.assertTrue(all(write["currentDocument"] == {"exists": False} for write in writes))
        year = next(write for write in writes if write["update"]["name"].endswith("schoolYears/2026-2027"))
        self.assertEqual(year["update"]["fields"]["isCurrent"], {"booleanValue": False})
        stats = next(write for write in writes if write["update"]["name"].endswith("publicStats/summary"))
        self.assertEqual(stats["update"]["fields"]["schoolYear"], {"stringValue": "2025-2026"})
        self.assertEqual(plan.documents[0].data, original)

    def test_rerun_with_all_existing_documents_makes_no_remote_writes(self):
        plan = prepare_plan(self.options)
        client, session = self.client([])
        client.existing = Mock(return_value={doc.path: {"fields": {}} for doc in plan.documents})
        self.assertEqual(provision_documents(plan, client, lambda _: None), (0, 9))
        session.request.assert_not_called()

    def test_permission_error_does_not_commit_or_expose_response_content(self):
        response = self.response({"error": "private_key: hidden-secret"}, 403)
        client, session = self.client([response])
        with self.assertRaisesRegex(ProvisionError, "Permission denied") as error:
            client.preflight()
        self.assertNotIn("hidden-secret", str(error.exception))
        self.assertEqual(session.request.call_count, 1)

    def test_cancellation_stops_before_commit(self):
        plan = prepare_plan(self.options)
        client = Mock(cancel=Event())
        client.cancel.set()
        client.existing.return_value = {doc.path: None for doc in plan.documents}
        with self.assertRaises(Cancelled):
            provision_documents(plan, client, lambda _: None)
        client.commit.assert_not_called()

    def test_cli_is_preflighted_before_any_database_write(self):
        plan = prepare_plan(replace(self.options, deploy_rules=True))
        with patch("edash_provision.runner.firebase_command", side_effect=ProvisionError("CLI missing")), patch("edash_provision.runner.authorized_session") as auth:
            with self.assertRaisesRegex(ProvisionError, "CLI missing"):
                run_plan(plan, dry_run=False, log=lambda _: None)
            auth.assert_not_called()

    def test_deployment_failure_reports_database_step_was_completed(self):
        plan = prepare_plan(replace(self.options, deploy_rules=True))
        with patch("edash_provision.runner.firebase_command", return_value=["node", "firebase.js"]), patch("edash_provision.runner.authorized_session"), patch("edash_provision.runner.FirestoreClient"), patch("edash_provision.runner.provision_documents", return_value=(9, 0)), patch("edash_provision.runner.deploy", side_effect=ProvisionError("deployment refused")):
            with self.assertRaisesRegex(ProvisionError, "Database step completed.*Database changes are retained"):
                run_plan(plan, dry_run=False, log=lambda _: None)

    def test_deployment_uses_isolated_config_and_selected_key_without_shell(self):
        plan = prepare_plan(replace(self.options, deploy_rules=True, deploy_indexes=True))
        plan = replace(plan, options=replace(plan.options, service_account=self.folder / "key with spaces.json"))
        captured = {}
        def capture(command, workdir, env, cancel, log):
            captured.update(command=command, config=json.loads((workdir / "firebase.json").read_text()), env=env)
            self.assertEqual((workdir / "firestore.rules").read_text(encoding="utf-8"), plan.rules)
        with patch("edash_provision.deployment._run", side_effect=capture), patch.dict(os.environ, {"FIREBASE_TOKEN": "not-used"}):
            deploy(plan, ["node", "firebase.js"], Event(), lambda _: None)
        self.assertEqual(set(captured["config"]), {"firestore"})
        self.assertNotIn("--force", captured["command"])
        self.assertIn("firestore:rules,firestore:indexes", captured["command"])
        self.assertNotIn("FIREBASE_TOKEN", captured["env"])
        self.assertEqual(captured["env"]["GOOGLE_APPLICATION_CREDENTIALS"], str(plan.options.service_account.resolve()))

    def test_optional_admin_profile_does_not_create_fake_auth_accounts(self):
        plan = prepare_plan(replace(self.options, admin_uid="existing-auth-uid", admin_email="admin@example.edu"))
        doc = plan.documents[-1]
        self.assertEqual(doc.path, "users/existing-auth-uid")
        self.assertEqual(doc.data["role"], "School Admin")
        self.assertNotIn("password", doc.data)
        with self.assertRaises(ProvisionError):
            prepare_plan(replace(self.options, admin_uid="existing-auth-uid"))

    def test_commands_keep_arguments_separate_and_live_requires_confirmation(self):
        options = replace(self.options, source=self.folder / "input & file.json", service_account=self.folder / "key.json")
        command = command_for(options, dry_run=False, entry=Path("main.py"))
        self.assertIn(str(options.source), command)
        self.assertIn("--apply", command)
        self.assertIn("--confirm-project", command)
        with patch("edash_provision.cli.prepare_plan") as prepare, patch("sys.stderr", new=io.StringIO()):
            self.assertEqual(main(["tenant", "--project", "sample-tenant", "--apply"]), 1)
            prepare.assert_not_called()

    def test_redaction_removes_tokens_and_key_material(self):
        self.assertNotIn("secret-value", redact_output("Bearer secret-value"))
        self.assertEqual(redact_output('"private_key": "secret-value"'), "[Credential-related output hidden]")
        self.assertEqual(redact_output("\x1b[31mDeploying rules\x1b[0m"), "Deploying rules")

    def test_multiline_private_key_output_is_hidden_until_end_marker(self):
        redactor = OutputRedactor()
        self.assertIn("hidden", redactor.line("-----BEGIN PRIVATE KEY-----"))
        self.assertIn("hidden", redactor.line("secret-base64-body"))
        self.assertIn("hidden", redactor.line("-----END PRIVATE KEY-----"))
        self.assertEqual(redactor.line("Deployment complete"), "Deployment complete")

    def test_standalone_copy_runs_without_website_sources(self):
        package = Path(__file__).resolve().parents[1]
        root = package.parents[1]
        shutil.copy2(root / "main.py", self.folder / "main.py")
        shutil.copytree(package, self.folder / "src/edash_provision", ignore=shutil.ignore_patterns("node_modules", "__pycache__", "tests"))
        result = subprocess.run([sys.executable, str(self.folder / "main.py"), "tenant", "--project", "sample-tenant", "--dry-run"], cwd=self.folder, text=True, encoding="utf-8", capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Document candidates: 9", result.stdout)
        self.assertIn("DRY RUN COMPLETE", result.stdout)


if __name__ == "__main__":
    unittest.main()
