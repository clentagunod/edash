"""Small authenticated Firestore REST client, with bounded requests and no gRPC dependency."""

from copy import deepcopy
import json
from threading import Event
from typing import Callable

from .codec import make_write
from .models import Cancelled, Plan, ProvisionError
from .validation import validate_service_account

SCOPES = ("https://www.googleapis.com/auth/cloud-platform",)


def check_cancel(cancel: Event) -> None:
    if cancel.is_set():
        raise Cancelled("Cancellation requested. Completed remote operations are retained; inspect the log before retrying.")


def authorized_session(plan: Plan):
    try:
        import google.auth
        from google.auth.transport.requests import AuthorizedSession
        from google.oauth2 import service_account
    except ImportError as exc:
        raise ProvisionError("Google authentication dependency is missing. Install src/edash_provision/requirements.txt in provisionenv.") from exc
    try:
        if plan.options.service_account:
            info = validate_service_account(plan.options.service_account, plan.options.project)
            credentials = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
        else:
            credentials, _ = google.auth.default(scopes=SCOPES)
        return AuthorizedSession(credentials, refresh_timeout=30, max_refresh_attempts=1)
    except ProvisionError:
        raise
    except Exception as exc:
        raise ProvisionError("Cannot initialize Google credentials. Select a valid service-account key or configure Application Default Credentials.") from exc


class FirestoreClient:
    def __init__(self, project: str, session, cancel: Event):
        self.project = project
        self.session = session
        self.cancel = cancel
        self.database = f"projects/{project}/databases/(default)"
        self.base = f"https://firestore.googleapis.com/v1/{self.database}"

    def request(self, method: str, url: str, payload=None):
        check_cancel(self.cancel)
        try:
            response = self.session.request(method, url, json=payload, timeout=(10, 45), max_allowed_time=80)
        except Exception as exc:
            # Authentication/network exceptions may contain sensitive request details.
            raise ProvisionError("Google request failed or timed out. Check connectivity and credentials. If a commit was in flight, verify the project before retrying; it may have completed.") from exc
        if not response.ok:
            code = response.status_code
            explanations = {
                400: "Google rejected the request. Check document values and ensure the database uses Firestore Native mode.",
                401: "Google credentials were rejected. Check that the service key is valid and has not been revoked.",
                403: "Permission denied. The selected identity needs Firestore read/write permissions on this project; ensure the API is enabled.",
                404: "The project or (default) Firestore database was not found. Create the database in Firebase Console first.",
                409: "A document changed during provisioning. The atomic document commit was rejected. Review and retry the create-only operation.",
                412: "A document precondition failed. Review and retry; existing documents are protected.",
                429: "Google quota/rate limit reached. Wait before retrying.",
            }
            raise ProvisionError(f"HTTP {code}: {explanations.get(code, 'Google service error. A commit may have completed; verify remote state before retrying.')} ")
        try:
            return response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise ProvisionError("Google returned an unexpected response. If a commit was sent, verify remote state before retrying.") from exc

    def preflight(self) -> None:
        database = self.request("GET", self.base)
        if not isinstance(database, dict) or database.get("name") != self.database:
            raise ProvisionError("Google returned a different database than the selected target.")
        if database.get("type") != "FIRESTORE_NATIVE":
            raise ProvisionError("This app requires a Firestore Native mode database.")

    def existing(self, paths: list[str]) -> dict[str, dict | None]:
        result: dict[str, dict | None] = {}
        prefix = self.database + "/documents/"
        for offset in range(0, len(paths), 100):
            chunk = paths[offset:offset + 100]
            requested = {prefix + path for path in chunk}
            rows = self.request("POST", self.base + "/documents:batchGet", {"documents": sorted(requested)})
            if not isinstance(rows, list):
                raise ProvisionError("Unexpected Firestore batch-read response; no writes were attempted.")
            returned = set()
            for row in rows:
                if not isinstance(row, dict):
                    raise ProvisionError("Incomplete Firestore read response; no writes were attempted.")
                found = row.get("found")
                name = found.get("name") if isinstance(found, dict) else row.get("missing")
                if name not in requested or name in returned:
                    raise ProvisionError("Unexpected or duplicate document in read response; no writes were attempted.")
                returned.add(name)
                result[name[len(prefix):]] = found
            if returned != requested:
                raise ProvisionError("Some requested documents were not returned; no writes were attempted.")
        return result

    def commit(self, writes: list[dict]) -> None:
        if writes:
            self.request("POST", self.base + "/documents:commit", {"writes": writes})


def provision_documents(plan: Plan, client: FirestoreClient, log: Callable[[str], None]) -> tuple[int, int]:
    if plan.options.mode == "register":
        doc = plan.documents[0]
        log(f"Committing registration merge: {doc.path}")
        client.commit([make_write(plan.options.project, doc.path, doc.data, merge=True)])
        log("Registration saved. Omitted fields were retained; supplied arrays replace previous arrays. enabled=true; timestamps generated on the server.")
        return 1, 0

    snapshots = client.existing([doc.path for doc in plan.documents])
    current = snapshots.get("settings/currentSchoolYear") or {}
    configured_year = current.get("fields", {}).get("value", {}).get("stringValue") or plan.options.school_year
    writes = []
    skipped = 0
    for doc in plan.documents:
        if snapshots[doc.path] is not None:
            skipped += 1
            log(f"PRESERVED  {doc.path}")
            continue
        data = deepcopy(doc.data)
        if doc.path == f"schoolYears/{plan.options.school_year}":
            data["isCurrent"] = configured_year == plan.options.school_year
        if doc.path == "publicStats/summary":
            data["schoolYear"] = configured_year
            if isinstance(data.get("enrollmentData"), dict):
                data["enrollmentData"]["schoolYear"] = configured_year
        writes.append(make_write(plan.options.project, doc.path, data))
        log(f"PREPARED   {doc.path}")
    check_cancel(client.cancel)
    log(f"Committing {len(writes)} missing documents atomically; {skipped} existing documents preserved.")
    client.commit(writes)
    log(f"Database step complete: {len(writes)} created, {skipped} preserved. Existing current year: {configured_year}.")
    return len(writes), skipped
