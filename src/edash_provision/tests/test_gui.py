"""Tk workflows and actual child-process dry runs. No Google requests or deployments."""

from pathlib import Path
import json
import sys
import tempfile
import time
import tkinter as tk
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from edash_provision.gui import ProvisionApp
from edash_provision.models import ASSETS


class GuiTests(unittest.TestCase):
    def setUp(self):
        try:
            self.root = tk.Tk()
        except tk.TclError as exc:
            self.skipTest(f"Tk desktop unavailable: {exc}")
        self.root.withdraw()
        self.app = ProvisionApp(self.root)
        self.root.update()

    def tearDown(self):
        if hasattr(self, "root"):
            self.app.shutdown()

    def pump_until_finished(self):
        deadline = time.monotonic() + 20
        while self.app.busy and time.monotonic() < deadline:
            self.root.update()
            time.sleep(0.01)
        self.assertFalse(self.app.busy, "Dry-run child did not finish")

    def test_default_is_dry_run_and_mode_inputs_are_independent(self):
        self.assertTrue(self.app.dry_run.get())
        self.app.inputs["register"]["project"].set("central-registry")
        self.app.notebook.select(1)
        self.root.update()
        self.app.inputs["tenant"]["project"].set("sample-tenant")
        self.app._preview()
        command = self.app.command.get("1.0", "end")
        self.assertIn("tenant --project sample-tenant", command)
        self.assertIn("--dry-run", command)
        self.assertNotIn("central-registry", command)
        self.app.notebook.select(0)
        self.root.update()
        self.assertEqual(self.app._options().project, "central-registry")

    def test_real_tenant_child_process_completes_a_dry_run(self):
        self.app.notebook.select(1)
        self.root.update()
        data = self.app.inputs["tenant"]
        data["project"].set("sample-tenant")
        data["rules"].set(True)
        data["indexes"].set(True)
        self.app._start()
        self.assertTrue(self.app.busy)
        self.assertIn("disabled", self.app.run_button.state())
        self.pump_until_finished()
        text = self.app.log_box.get("1.0", "end")
        self.assertIn("DRY RUN COMPLETE", text)
        self.assertIn("firestore:rules, firestore:indexes", text)
        self.assertEqual(self.app.status.get(), "Completed successfully")

    def test_real_registration_child_process_completes_a_dry_run(self):
        with tempfile.TemporaryDirectory() as folder:
            registration = json.loads((ASSETS / "school-registration.example.json").read_text(encoding="utf-8"))
            registration["firebaseConfig"].update(apiKey="public-web-key", messagingSenderId="123456789", appId="1:123456789:web:abc")
            source = Path(folder) / "school.json"
            source.write_text(json.dumps(registration), encoding="utf-8")
            self.app.inputs["register"]["source"].set(str(source))
            self.app.inputs["register"]["project"].set("central-registry")
            self.app._start()
            self.pump_until_finished()
            text = self.app.log_box.get("1.0", "end")
            self.assertIn("MERGE  schools/sample-elementary", text)
            self.assertIn("DRY RUN COMPLETE", text)

    def test_small_window_keeps_status_and_progress_in_view(self):
        self.root.deiconify()
        self.root.geometry("760x640")
        self.root.update()
        self.assertLessEqual(self.app.progress.winfo_rooty() + self.app.progress.winfo_height(), self.root.winfo_rooty() + self.root.winfo_height() - 20)

    def test_live_confirmation_can_cancel_without_starting_a_process(self):
        self.app.notebook.select(1)
        self.root.update()
        self.app.inputs["tenant"]["project"].set("sample-tenant")
        self.app.dry_run.set(False)
        with patch("edash_provision.gui.messagebox.askyesno", return_value=False) as confirm, patch("edash_provision.gui.subprocess.Popen") as process:
            self.app._start()
        self.assertIn("sample-tenant", confirm.call_args.args[1])
        process.assert_not_called()
        self.assertFalse(self.app.busy)

    def test_invalid_inputs_do_not_start_a_process(self):
        with patch("edash_provision.gui.messagebox.showerror") as error, patch("edash_provision.gui.subprocess.Popen") as process:
            self.app._start()
        error.assert_called_once()
        process.assert_not_called()

    def test_cancel_is_cooperative_and_does_not_block_the_event_loop(self):
        self.app.notebook.select(1)
        self.root.update()
        self.app.inputs["tenant"]["project"].set("sample-tenant")
        self.app._start()
        self.app._cancel()
        self.assertTrue(self.app.cancel_requested.is_set())
        self.pump_until_finished()
        self.assertIn(self.app.status.get(), ("Completed successfully", "Stopped · review completed steps in the log"))


if __name__ == "__main__":
    unittest.main()
