"""Run Firebase CLI without a shell, deployment hooks, or website dependencies."""

import json
import os
from pathlib import Path
import queue
import re
import shlex
import shutil
import subprocess
import tempfile
from threading import Event, Thread
import time
from typing import Callable

from .firestore import check_cancel
from .models import Cancelled, Plan, ProvisionError

PACKAGE = Path(__file__).resolve().parent


def display_command(command: list[str]) -> str:
    return subprocess.list2cmdline(command) if os.name == "nt" else shlex.join(command)


def firebase_command() -> list[str]:
    node = shutil.which("node")
    if node:
        try:
            version = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=5, shell=False,
                                     creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            major = re.match(r"v(\d+)", version.stdout.strip())
            if version.returncode or not major or int(major[1]) < 20:
                raise ProvisionError("The bundled Firebase CLI requires Node.js 20 or newer.")
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ProvisionError("Cannot start Node.js. Install Node.js 20+ before selecting CLI deployment.") from exc
    local = PACKAGE / "tools/node_modules/firebase-tools/lib/bin/firebase.js"
    if node and local.is_file():
        return [node, str(local)]
    binary = shutil.which("firebase")
    if binary:
        path = Path(binary)
        if path.suffix.lower() not in {".cmd", ".bat", ".ps1"}:
            return [binary]
        # Execute the JS entry directly instead of passing paths through cmd.exe.
        entry = path.parent / "node_modules/firebase-tools/lib/bin/firebase.js"
        if node and entry.is_file():
            return [node, str(entry)]
    raise ProvisionError("Firebase CLI was not found. Install the bundled tool once: npm ci --prefix src/edash_provision/tools (Node.js 20+). Database-only provisioning does not need Node.js.")


def redact_output(text: str) -> str:
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    if re.search(r"private[_ -]?key|-----BEGIN|-----END|ya29\.", text, re.I):
        return "[Credential-related output hidden]"
    return re.sub(r"(?i)(Bearer\s+|access_token[\s\"':=]+|refresh_token[\s\"':=]+)\S+", r"\1[redacted]", text)


class OutputRedactor:
    """Hide complete PEM blocks even when a child emits them on separate lines."""

    def __init__(self):
        self.in_key = False

    def line(self, text: str) -> str:
        if re.search(r"-----BEGIN [A-Z ]*PRIVATE KEY-----", text):
            self.in_key = True
        if self.in_key:
            if re.search(r"-----END [A-Z ]*PRIVATE KEY-----", text):
                self.in_key = False
            return "[Credential-related output hidden]"
        return redact_output(text)


def _run(command: list[str], workdir: Path, env: dict, cancel: Event, log: Callable[[str], None], timeout: float = 900) -> None:
    check_cancel(cancel)
    log("Firebase CLI: " + display_command(command))
    try:
        process = subprocess.Popen(command, cwd=workdir, env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                   encoding="utf-8", errors="replace", shell=False,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    except OSError as exc:
        raise ProvisionError("Cannot start Firebase CLI. Check the Node.js/CLI installation.") from exc
    lines: queue.Queue[str | None] = queue.Queue(maxsize=1000)

    def read_output():
        try:
            assert process.stdout is not None
            for line in process.stdout:
                lines.put(line.rstrip())
        finally:
            lines.put(None)

    Thread(target=read_output, daemon=True).start()
    started = time.monotonic()
    redactor = OutputRedactor()
    try:
        while True:
            if cancel.is_set():
                raise Cancelled("Firebase CLI was stopped. A remote deployment may already have applied; check the project before retrying.")
            if time.monotonic() - started > timeout:
                raise ProvisionError("Firebase CLI exceeded 15 minutes. Check the project's deployment status before retrying.")
            try:
                line = lines.get(timeout=0.1)
            except queue.Empty:
                continue
            if line is None:
                break
            log(redactor.line(line))
        code = process.wait(timeout=5)
        if code:
            raise ProvisionError(f"Firebase CLI exited with code {code}. Check the deployment log; index changes may require additional IAM permissions.")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if process.stdout:
            process.stdout.close()


def deploy(plan: Plan, command: list[str], cancel: Event, log: Callable[[str], None]) -> None:
    with tempfile.TemporaryDirectory(prefix="edash-provision-") as folder:
        workdir = Path(folder)
        firestore = {}
        if plan.rules is not None:
            (workdir / "firestore.rules").write_text(plan.rules, encoding="utf-8")
            firestore["rules"] = "firestore.rules"
        if plan.indexes is not None:
            (workdir / "firebase.index.json").write_text(json.dumps(plan.indexes), encoding="utf-8")
            firestore["indexes"] = "firebase.index.json"
        config = workdir / "firebase.json"
        config.write_text(json.dumps({"firestore": firestore}), encoding="utf-8")
        env = os.environ.copy()
        env.update({"CI": "true", "NO_COLOR": "1", "NO_UPDATE_NOTIFIER": "1", "FIREBASE_CLI_DISABLE_UPDATE_CHECK": "true"})
        env.pop("DEBUG", None)
        env["FIREBASE_DEBUG_PATH"] = str(workdir / "firebase-debug.log")
        env.pop("FIREBASE_TOKEN", None)
        if plan.options.service_account:
            env["GOOGLE_APPLICATION_CREDENTIALS"] = str(plan.options.service_account.resolve())
            # Keep a cached CLI login from taking precedence over the selected key.
            env["XDG_CONFIG_HOME"] = str(workdir / "cli-config")
        command = command + ["deploy", "--only", ",".join(plan.targets), "--project", plan.options.project,
                             "--config", str(config), "--non-interactive"]
        log("Using isolated Firestore-only configuration; no Hosting/Functions deployment or hooks.")
        _run(command, workdir, env, cancel, log)

