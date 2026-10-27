"""CLI shared with the GUI; defaults to an offline dry run."""

import argparse
import importlib.util
import os
from pathlib import Path
import sys
from threading import Event, Thread

from .deployment import display_command, firebase_command
from .models import ASSETS, Cancelled, Options, ProvisionError
from .runner import run_plan
from .validation import prepare_plan


def arguments(argv=None):
    parser = argparse.ArgumentParser(description="Edash Provision — registration and tenant Firestore setup")
    sub = parser.add_subparsers(dest="mode", required=True)
    sub.add_parser("doctor", help="Show local Python/Tk/authentication/CLI dependencies; no network calls")
    for mode in ("register", "tenant"):
        child = sub.add_parser(mode, help="Register a school in the central project" if mode == "register" else "Create missing tenant structure documents")
        child.add_argument("--project", required=True, help="Explicit target Firebase project ID")
        child.add_argument("--service-account", type=Path, help="Selected project's service-account JSON; otherwise ADC")
        child.add_argument("--deploy-rules", action="store_true")
        if mode == "register":
            child.add_argument("--registration", type=Path, required=True)
        else:
            child.add_argument("--structure", type=Path, default=ASSETS / "tenant-structure.json")
            child.add_argument("--school-year", default="2026-2027")
            child.add_argument("--deploy-indexes", action="store_true")
            child.add_argument("--admin-uid", default="", help="Optional existing Firebase Authentication UID (no Auth account is created)")
            child.add_argument("--admin-email", default="")
            child.add_argument("--admin-name", default="School Administrator")
        group = child.add_mutually_exclusive_group()
        group.add_argument("--dry-run", action="store_true", help="Offline validation only (default)")
        group.add_argument("--apply", action="store_true", help="Write to the selected project; requires --confirm-project")
        child.add_argument("--confirm-project", default="")
        child.add_argument("--input-sha256", default="", help=argparse.SUPPRESS)
        child.add_argument("--gui-control", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def doctor(log=print):
    log(f"Python: {sys.version.split()[0]} | environment: {Path(sys.prefix).name}")
    for module in ("tkinter", "google.auth", "requests"):
        try:
            found = importlib.util.find_spec(module) is not None
        except ModuleNotFoundError:
            found = False
        log(f"{module}: {'available' if found else 'missing'}")
    try:
        log("Firebase CLI: " + display_command(firebase_command()))
    except ProvisionError as exc:
        log(str(exc))


def command_for(options: Options, *, dry_run: bool, entry: Path, gui_control: bool = False, source_hash: str = "") -> list[str]:
    command = [sys.executable, str(entry), options.mode, "--project", options.project,
               "--registration" if options.mode == "register" else "--structure", str(options.source)]
    if options.service_account:
        command.extend(["--service-account", str(options.service_account)])
    if options.mode == "tenant":
        command.extend(["--school-year", options.school_year])
        if options.deploy_indexes:
            command.append("--deploy-indexes")
        if options.admin_uid or options.admin_email:
            command.extend(["--admin-uid", options.admin_uid, "--admin-email", options.admin_email, "--admin-name", options.admin_name])
    if options.deploy_rules:
        command.append("--deploy-rules")
    if dry_run:
        command.append("--dry-run")
    else:
        command.extend(["--apply", "--confirm-project", options.project])
    if source_hash:
        command.extend(["--input-sha256", source_hash])
    if gui_control:
        command.append("--gui-control")
    return command


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    args = arguments(argv)
    if args.mode == "doctor":
        doctor()
        return 0
    cancel = Event()
    if args.gui_control:
        def control():
            for line in sys.stdin:
                if line.strip() == "cancel":
                    cancel.set()
                    return
        Thread(target=control, daemon=True).start()
    try:
        if args.apply and args.confirm_project != args.project:
            raise ProvisionError("Live provisioning requires --confirm-project exactly matching --project.")
        service = args.service_account
        if service is None and os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
            service = Path(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
        options = Options(
            mode=args.mode, project=args.project, source=(args.registration if args.mode == "register" else args.structure).expanduser().resolve(),
            service_account=service.expanduser().resolve() if service else None,
            school_year=getattr(args, "school_year", "2026-2027"), deploy_rules=args.deploy_rules,
            deploy_indexes=getattr(args, "deploy_indexes", False), admin_uid=getattr(args, "admin_uid", ""),
            admin_email=getattr(args, "admin_email", ""), admin_name=getattr(args, "admin_name", "School Administrator"),
        )
        plan = prepare_plan(options, args.input_sha256)
        run_plan(plan, dry_run=not args.apply, cancel=cancel)
        return 0
    except (Cancelled, KeyboardInterrupt) as exc:
        print(f"STOPPED: {exc or 'Interrupted; verify any in-flight remote operations.'}")
        return 130
    except ProvisionError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except Exception:
        print("ERROR: Unexpected local failure. Verify any in-flight remote operation before retrying. No credential details were logged.", file=sys.stderr)
        return 1
