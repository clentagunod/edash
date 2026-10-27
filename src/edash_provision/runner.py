"""Orchestrate independent database and optional CLI steps."""

from threading import Event
from typing import Callable

from .deployment import deploy, firebase_command
from .firestore import FirestoreClient, authorized_session, check_cancel, provision_documents
from .models import Cancelled, Plan, ProvisionError


def run_plan(plan: Plan, *, dry_run: bool, log: Callable[[str], None] = print, cancel: Event | None = None) -> None:
    cancel = cancel or Event()
    log(plan.summary())
    check_cancel(cancel)
    if dry_run:
        if plan.targets:
            log("Planned Firebase CLI targets: " + ", ".join(plan.targets))
        log("DRY RUN COMPLETE — offline validation only. No authentication, network requests, Firestore writes, or deployments. Existing-document counts and IAM access are not checked.")
        return
    cli = firebase_command() if plan.targets else []  # Fail before database writes when a selected tool is missing.
    check_cancel(cancel)
    session = authorized_session(plan)
    try:
        client = FirestoreClient(plan.options.project, session, cancel)
        log("Checking the selected project's (default) Firestore Native database…")
        client.preflight()
        created, skipped = provision_documents(plan, client, log)
        if plan.targets:
            try:
                check_cancel(cancel)
                deploy(plan, cli, cancel, log)
            except Cancelled as exc:
                raise Cancelled(f"Database step completed ({created} saved, {skipped} preserved). {exc}") from exc
            except ProvisionError as exc:
                raise ProvisionError(f"Database step completed ({created} saved, {skipped} preserved). Optional deployment failed: {exc} Database changes are retained.") from exc
        log("DONE — selected provisioning steps completed. New indexes may still be building in Firebase Console.")
    finally:
        session.close()
