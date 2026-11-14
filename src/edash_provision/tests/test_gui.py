"""Tk workflows and actual child-process dry runs. No Google requests or deployments."""

from pathlib import Path
import json
import sys
import tempfile
import time
import tkinter as tk
from tkinter import ttk
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from edash_provision.gui import FormField, ProvisionApp
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
            registration["logoUrl"] = "public/assets/inopawan/logo.png"
            registration["videoUrl"] = "public/assets/inopawan/video.mp4"
            source = Path(folder) / "school.json"
            source.write_text(json.dumps(registration), encoding="utf-8")
            self.app.inputs["register"]["source"].set(str(source))
            self.app.inputs["register"]["project"].set("central-registry")
            self.app._start()
            self.pump_until_finished()
            text = self.app.log_box.get("1.0", "end")
            self.assertIn("MERGE  schools/sample-elementary", text)
            self.assertIn("Logo (website path): /assets/inopawan/logo.png", text)
            self.assertIn("DRY RUN COMPLETE", text)

    def test_small_window_keeps_status_and_progress_in_view(self):
        self.root.deiconify()
        self.root.geometry("760x640")
        self.root.update()
        self.assertLessEqual(self.app.progress.winfo_rooty() + self.app.progress.winfo_height(), self.root.winfo_rooty() + self.root.winfo_height() - 20)

    def assert_in_view(self, widget, viewport=None):
        viewport = viewport or self.root
        self.assertTrue(widget.winfo_ismapped(), str(widget))
        x = widget.winfo_rootx() - viewport.winfo_rootx()
        y = widget.winfo_rooty() - viewport.winfo_rooty()
        self.assertGreaterEqual(x, 0, str(widget))
        self.assertGreaterEqual(y, 0, str(widget))
        self.assertLessEqual(x + widget.winfo_width(), viewport.winfo_width(), str(widget))
        self.assertLessEqual(y + widget.winfo_height(), viewport.winfo_height(), str(widget))

    def test_resize_and_text_scaling_keep_actions_and_status_visible(self):
        self.root.deiconify()
        for scale in ("85%", "100%", "150%"):
            self.app._set_text_size(scale)
            for size in ("420x420", "480x520", "760x640", "1280x720"):
                for dry in (True, False):
                    with self.subTest(scale=scale, size=size, dry=dry):
                        self.root.geometry(size)
                        self.app.dry_run.set(dry)
                        self.app._preview()
                        self.root.update()
                        for widget in (self.app.heading, self.app.size_picker, self.app.output_button,
                                       self.app.dry_check, self.app.run_button, self.app.cancel_button,
                                       self.app.progress, self.app.status_label):
                            self.assert_in_view(widget)
                        form = self.app.forms[self.app.mode()]
                        for field in (child for child in form.body.winfo_children() if isinstance(child, FormField)):
                            # Vertical scrolling is intentional; horizontal clipping is not.
                            self.assertGreaterEqual(field.entry.winfo_width(), 80)
                            self.assertLessEqual(field.winfo_x() + field.winfo_width(), form.canvas.winfo_width())

    def test_short_window_can_switch_between_setup_and_readable_output(self):
        self.root.deiconify()
        self.app._set_text_size("150%")
        self.root.geometry("420x420")
        self.root.update()
        self.assertTrue(self.app.compact)
        self.assertFalse(self.app.output_visible)
        self.assert_in_view(self.app.form_panel, self.app.panes)
        self.app._toggle_output()
        self.root.update()
        self.assert_in_view(self.app.output_panel, self.app.panes)
        self.assert_in_view(self.app.log_box)
        self.assertGreaterEqual(self.app.log_box.winfo_height(), 30)
        self.app.output_notebook.select(1)
        self.root.update()
        self.assert_in_view(self.app.command)
        self.app._toggle_output()
        self.root.update()
        self.assert_in_view(self.app.form_panel, self.app.panes)

    def test_wide_layout_and_collapsing_output_preserve_inputs_and_log(self):
        self.root.deiconify()
        self.root.geometry("1280x720")
        self.root.update()
        self.app.notebook.select(1)
        self.app.inputs["tenant"]["project"].set("sample-tenant")
        self.app._log("Layout check")
        self.root.update()
        self.assertEqual(self.app.orientation, "horizontal")
        self.assertGreater(self.app.output_panel.winfo_x(), self.app.form_panel.winfo_width())
        # Dragging the divider to either extreme must leave both panels usable.
        for target in (5, 1270):
            sash_x, _ = self.app.panes.sash_coord(0)
            self.app.panes.event_generate("<ButtonPress-1>", x=sash_x + 3, y=50)
            self.app.panes.event_generate("<B1-Motion>", x=target, y=50)
            self.app.panes.event_generate("<ButtonRelease-1>", x=target, y=50)
            self.root.update()
            self.assertGreaterEqual(self.app.form_panel.winfo_width(), 360)
            self.assertGreaterEqual(self.app.output_panel.winfo_width(), 320)
        self.app._toggle_output()
        self.root.update()
        self.assertGreater(self.app.form_panel.winfo_width(), 1200)
        self.app._toggle_output()
        self.root.geometry("760x640")
        self.root.update()
        self.assertEqual(self.app.orientation, "vertical")
        self.assertGreater(self.app.output_panel.winfo_y(), self.app.form_panel.winfo_height())
        self.assertEqual(self.app._options().project, "sample-tenant")
        self.assertIn("Layout check", self.app.log_box.get("1.0", "end"))

    def test_keyboard_focus_and_mouse_wheel_reach_admin_fields(self):
        self.root.deiconify()
        self.root.geometry("480x520")
        self.app.notebook.select(1)
        self.root.update()
        data = self.app.inputs["tenant"]
        data["admin"].set(True)
        self.app._toggle_admin("tenant")
        self.root.update()
        form = self.app.forms["tenant"]
        fields = [child for child in data["admin_frame"].winfo_children() if isinstance(child, FormField)]
        for scale in ("100%", "150%"):
            with self.subTest(scale=scale):
                self.app._set_text_size(scale)
                self.root.update()
                form.canvas.yview_moveto(0)
                fields[-1].entry.event_generate("<FocusIn>")
                self.root.update()
                self.assert_in_view(fields[-1].entry, form.canvas)
                form.canvas.yview_moveto(0)
                fields[0].entry.event_generate("<MouseWheel>", delta=-120)
                self.root.update()
                self.assertGreater(form.canvas.yview()[0], 0)
        # Scrolling the output must not also scroll the form.
        before = form.canvas.yview()
        self.app.log_box.event_generate("<MouseWheel>", delta=-120)
        self.root.update()
        self.assertEqual(form.canvas.yview(), before)

    def test_editor_resizes_with_both_scrollbars_and_save_button_visible(self):
        self.root.deiconify()
        self.app._editor("tenant")
        self.root.update()
        window = next(child for child in self.root.winfo_children() if isinstance(child, tk.Toplevel))
        try:
            window.geometry("420x320")
            self.root.update()
            frame = next(child for child in window.winfo_children() if isinstance(child, ttk.Frame))
            editor = next(child for child in frame.winfo_children() if isinstance(child, tk.Text))
            save_button = next(child for child in window.winfo_children() if isinstance(child, ttk.Button))
            self.assert_in_view(editor, window)
            self.assert_in_view(save_button, window)
            scrollbars = [child for child in frame.winfo_children() if isinstance(child, ttk.Scrollbar)]
            self.assertEqual({str(bar.cget("orient")) for bar in scrollbars}, {"vertical", "horizontal"})
            editor.insert("end", "x" * 300)
            editor.xview_moveto(1)
            self.root.update()
            self.assertGreater(editor.xview()[0], 0)
        finally:
            window.destroy()

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

    def test_registration_editor_saves_canonical_logo_paths_and_hosted_urls(self):
        with tempfile.TemporaryDirectory() as folder:
            for reference, expected in (("public/assets/school/logo.png", "/assets/school/logo.png"),
                                        ("https://images.example/logo.png", "https://images.example/logo.png")):
                with self.subTest(reference=reference):
                    self.app._editor("register")
                    self.root.update()
                    window = next(child for child in self.root.winfo_children() if isinstance(child, tk.Toplevel))
                    frame = next(child for child in window.winfo_children() if isinstance(child, ttk.Frame))
                    editor = next(child for child in frame.winfo_children() if isinstance(child, tk.Text))
                    value = json.loads(editor.get("1.0", "end-1c"))
                    value["logoUrl"] = reference
                    value["videoUrl"] = "public/assets/school/video.mp4"
                    editor.delete("1.0", "end")
                    editor.insert("1.0", json.dumps(value))
                    destination = Path(folder) / "school.json"
                    save_button = next(child for child in window.winfo_children() if isinstance(child, ttk.Button))
                    with patch("edash_provision.gui.filedialog.asksaveasfilename", return_value=str(destination)):
                        save_button.invoke()
                    self.assertEqual(json.loads(destination.read_text(encoding="utf-8"))["logoUrl"], expected)
                    self.assertEqual(json.loads(destination.read_text(encoding="utf-8"))["videoUrl"], "/assets/school/video.mp4")
                    self.assertEqual(self.app.inputs["register"]["source"].get(), str(destination))

    def test_registration_editor_does_not_hide_duplicate_keys_when_normalizing(self):
        self.app._editor("register")
        self.root.update()
        window = next(child for child in self.root.winfo_children() if isinstance(child, tk.Toplevel))
        try:
            frame = next(child for child in window.winfo_children() if isinstance(child, ttk.Frame))
            editor = next(child for child in frame.winfo_children() if isinstance(child, tk.Text))
            editor.delete("1.0", "end")
            editor.insert("1.0", '{"logoUrl":"public/assets/logo.png","logoUrl":"assets/other.png"}')
            save_button = next(child for child in window.winfo_children() if isinstance(child, ttk.Button))
            with patch("edash_provision.gui.messagebox.showerror") as error, patch("edash_provision.gui.filedialog.asksaveasfilename") as save:
                save_button.invoke()
            self.assertIn("duplicate", error.call_args.args[1])
            save.assert_not_called()
        finally:
            window.destroy()

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
