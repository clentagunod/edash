"""Minimal ttk interface. All remote work runs in a separate Python process."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
from threading import Event, Lock, Thread
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from . import __version__
from .cli import command_for, doctor
from .deployment import OutputRedactor, display_command
from .models import ASSETS, Options, ProvisionError
from .validation import prepare_plan, read_json, reject_secrets

BG = "#f3f6f8"
INK = "#172b3a"
MUTED = "#617381"
ACCENT = "#087f74"
ENTRY = Path(__file__).resolve().parents[2] / "main.py"


class ScrollForm(ttk.Frame):
    def __init__(self, parent):
        super().__init__(parent, style="Surface.TFrame")
        self.canvas = tk.Canvas(self, background="white", highlightthickness=0, borderwidth=0)
        scrollbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.body = ttk.Frame(self.canvas, padding=(22, 18), style="Surface.TFrame")
        self.body.columnconfigure(1, weight=1)
        item = self.canvas.create_window(0, 0, anchor="nw", window=self.body)
        self.body.bind("<Configure>", self._body_changed)
        self.canvas.bind("<Configure>", lambda event: self.canvas.itemconfigure(item, width=event.width))
        self.bind_all("<MouseWheel>", self._wheel, add="+")

    def _body_changed(self, _):
        width = self.body.winfo_width()
        label_width = self.body.grid_bbox(0, 0)[2]
        for child in self.body.winfo_children():
            if isinstance(child, ttk.Label) and child.cget("style") == "Hint.TLabel":
                column = int(child.grid_info().get("column", 0))
                child.configure(wraplength=max(180, width - 44 - (label_width if column else 0)))
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def _wheel(self, event):
        widget = event.widget
        while widget is not None:
            if widget == self:
                self.canvas.yview_scroll(-int(event.delta / 120), "units")
                return
            widget = getattr(widget, "master", None)


class ProvisionApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("Edash Provision")
        self.icon = tk.PhotoImage(width=32, height=32)
        self.icon.put(ACCENT, to=(0, 0, 32, 32))
        for rectangle in ((6, 7, 9, 25), (9, 7, 15, 10), (9, 14, 14, 17), (9, 22, 15, 25),
                          (18, 7, 21, 25), (21, 7, 27, 10), (24, 10, 27, 16), (21, 15, 27, 18)):
            self.icon.put("white", to=rectangle)
        root.iconphoto(True, self.icon)
        root.configure(background=BG)
        width, height = min(1020, root.winfo_screenwidth() - 60), min(900, root.winfo_screenheight() - 80)
        root.geometry(f"{width}x{height}+{max(0, (root.winfo_screenwidth() - width) // 2)}+30")
        root.minsize(760, 640)
        self.events: queue.Queue = queue.Queue(maxsize=2000)
        self.redactor = OutputRedactor()
        self.process: subprocess.Popen | None = None
        self.process_lock = Lock()
        self.cancel_requested = Event()
        self.busy = False
        self.closing = False
        self.disposed = False
        self.preview_timer = None
        self.poll_timer = None
        self.layout_timer = None
        self.forms = {}
        self.inputs = {}
        self.dry_run = tk.BooleanVar(value=True)
        self._style()
        self._layout()
        self.dry_run.trace_add("write", self._changed)
        self.notebook.bind("<<NotebookTabChanged>>", self._changed)
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self.poll_timer = self.root.after(100, self._poll)
        self._preview()
        self._log(f"Edash Provision {__version__} · Python {sys.version.split()[0]} · environment {Path(sys.prefix).name}")
        self._log("Choose a mode and target project. Dry run validates locally and never connects to Firebase.")

    def _style(self):
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure(".", font=("Segoe UI", 10), background=BG, foreground=INK)
        style.configure("TFrame", background=BG)
        style.configure("Surface.TFrame", background="white")
        style.configure("Surface.TLabel", background="white")
        style.configure("Muted.TLabel", foreground=MUTED)
        style.configure("Hint.TLabel", foreground=MUTED, background="white", font=("Segoe UI", 9))
        style.configure("Heading.TLabel", font=("Segoe UI Semibold", 23))
        style.configure("Section.TLabel", font=("Segoe UI Semibold", 10))
        style.configure("TButton", padding=(12, 7), borderwidth=1, relief="flat", background="white")
        style.map("TButton", background=[("active", "#e5efed")], foreground=[("disabled", "#8b979f")])
        style.configure("Accent.TButton", background=ACCENT, foreground="white", borderwidth=0)
        style.map("Accent.TButton", background=[("disabled", "#9fbab6"), ("active", "#06695f")], foreground=[("disabled", "white")])
        style.configure("TEntry", padding=7, fieldbackground="white", bordercolor="#d5dfe5")
        style.configure("TCheckbutton", background="white", padding=(0, 4))
        style.configure("Footer.TCheckbutton", background=BG)
        style.configure("TNotebook", borderwidth=0, background=BG)
        style.configure("TNotebook.Tab", padding=(22, 10), background="#e3eaee", borderwidth=0)
        style.map("TNotebook.Tab", background=[("selected", "white")], foreground=[("selected", ACCENT)])
        style.configure("Horizontal.TProgressbar", background=ACCENT, troughcolor="#dfe8eb", borderwidth=0, thickness=3)

    def _layout(self):
        header = ttk.Frame(self.root, padding=(24, 19, 24, 15))
        header.pack(fill="x")
        tk.Label(header, text="EP", bg=ACCENT, fg="white", font=("Segoe UI Semibold", 18), padx=13, pady=9).pack(side="left", padx=(0, 15))
        copy = ttk.Frame(header)
        copy.pack(side="left")
        ttk.Label(copy, text="Edash Provision", style="Heading.TLabel").pack(anchor="w")
        ttk.Label(copy, text="School registration & tenant database setup", style="Muted.TLabel").pack(anchor="w")
        ttk.Label(header, text=f"v{__version__}", style="Muted.TLabel").pack(side="right")

        content = ttk.Frame(self.root, padding=(24, 0, 24, 18))
        content.pack(fill="both", expand=True)
        content.columnconfigure(0, weight=1)
        content.rowconfigure(0, weight=1)
        self.panes = ttk.Panedwindow(content, orient="vertical")
        self.panes.grid(row=0, column=0, sticky="nsew")
        top = ttk.Frame(self.panes)
        self.panes.add(top, weight=3)
        self.notebook = ttk.Notebook(top)
        self.notebook.pack(fill="both", expand=True)
        for mode, label in (("register", "Registration"), ("tenant", "Tenant provision")):
            form = ScrollForm(self.notebook)
            self.forms[mode] = form
            self.notebook.add(form, text=label)
            self._form(mode, form.body)

        actions = ttk.Frame(top, padding=(0, 10, 0, 8))
        actions.pack(fill="x")
        self.dry_check = ttk.Checkbutton(actions, text="Dry run · no remote changes", variable=self.dry_run, style="Footer.TCheckbutton")
        self.dry_check.pack(side="left")
        self.run_button = ttk.Button(actions, text="Run dry run", command=self._start, style="Accent.TButton")
        self.run_button.pack(side="right")
        self.cancel_button = ttk.Button(actions, text="Cancel", command=self._cancel, state="disabled")
        self.cancel_button.pack(side="right", padx=8)

        bottom = ttk.Frame(self.panes)
        self.panes.add(bottom, weight=2)
        ttk.Label(bottom, text="COMMAND", style="Section.TLabel").pack(anchor="w", pady=(9, 5))
        command_frame = ttk.Frame(bottom)
        command_frame.pack(fill="x")
        self.command = tk.Text(command_frame, height=3, wrap="word", background="#e8eef1", foreground=INK,
                               font=("Consolas", 9), relief="flat", padx=10, pady=8, state="disabled")
        command_scroll = ttk.Scrollbar(command_frame, command=self.command.yview)
        self.command.configure(yscrollcommand=command_scroll.set)
        command_scroll.pack(side="right", fill="y")
        self.command.pack(side="left", fill="x", expand=True)
        log_header = ttk.Frame(bottom, padding=(0, 9, 0, 5))
        log_header.pack(fill="x")
        ttk.Label(log_header, text="ACTIVITY LOG", style="Section.TLabel").pack(side="left")
        self.check_button = ttk.Button(log_header, text="Check tools", command=lambda: doctor(self._log))
        self.check_button.pack(side="right")
        ttk.Button(log_header, text="Save log", command=self._save_log).pack(side="right", padx=6)
        ttk.Button(log_header, text="Clear", command=self._clear_log).pack(side="right")
        log_frame = ttk.Frame(bottom)
        log_frame.pack(fill="both", expand=True)
        self.log_box = tk.Text(log_frame, height=8, wrap="word", background="#152a36", foreground="#dcebe9",
                               font=("Consolas", 10), relief="flat", padx=12, pady=10, state="disabled")
        scrollbar = ttk.Scrollbar(log_frame, command=self.log_box.yview)
        self.log_box.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.log_box.pack(side="left", fill="both", expand=True)
        self.progress = ttk.Progressbar(content, mode="indeterminate")
        self.progress.grid(row=1, column=0, sticky="ew", pady=(10, 6))
        self.status = tk.StringVar(value="Ready · local dry run selected")
        ttk.Label(content, textvariable=self.status, style="Muted.TLabel").grid(row=2, column=0, sticky="w")
        self.layout_timer = self.root.after_idle(self._place_sash)

    def _place_sash(self):
        self.layout_timer = None
        self.panes.sashpos(0, max(300, int(self.root.winfo_height() * 0.57)))

    def _var(self, value="", boolean=False):
        var = tk.BooleanVar(value=value) if boolean else tk.StringVar(value=value)
        var.trace_add("write", self._changed)
        return var

    def _form(self, mode: str, body: ttk.Frame):
        data = self.inputs[mode] = {
            "project": self._var(), "service": self._var(),
            "source": self._var(str(ASSETS / ("school-registration.example.json" if mode == "register" else "tenant-structure.json"))),
            "rules": self._var(False, True), "indexes": self._var(False, True),
            "year": self._var("2026-2027"), "admin": self._var(False, True),
            "uid": self._var(), "email": self._var(), "name": self._var("School Administrator"),
        }
        note = "Register or update one school's public directory entry in the central Firebase project." if mode == "register" else "Create the shared tenant schema. Existing records and the configured current year are preserved."
        ttk.Label(body, text=note, style="Hint.TLabel", wraplength=710).grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 16))
        self._field(body, 1, "Central project ID" if mode == "register" else "Tenant project ID", data["project"])
        if mode == "tenant":
            self._field(body, 2, "School year", data["year"])
        service_row = 3 if mode == "tenant" else 2
        source_row = 6 if mode == "tenant" else 4
        self._field(body, service_row, "Service key JSON", data["service"], lambda: self._browse(mode, "service"))
        ttk.Label(body, text="Use this project's service-account key, or leave blank for Application Default Credentials.", style="Hint.TLabel", wraplength=650).grid(row=service_row + 1, column=1, columnspan=2, sticky="w", pady=(0, 12))
        self._field(body, source_row, "Registration JSON" if mode == "register" else "Structure JSON", data["source"], lambda: self._browse(mode, "source"))
        tools = ttk.Frame(body, style="Surface.TFrame")
        tools.grid(row=source_row + 1, column=1, columnspan=2, sticky="w", pady=(0, 10))
        ttk.Button(tools, text="Edit JSON…", command=lambda: self._editor(mode)).pack(side="left")
        ttk.Button(tools, text="Export example…" if mode == "register" else "Export structure…", command=lambda: self._export(mode)).pack(side="left", padx=6)
        if mode == "tenant":
            ttk.Button(tools, text="Use default", command=lambda: data["source"].set(str(ASSETS / "tenant-structure.json"))).pack(side="left")
        else:
            ttk.Label(body, text="Edit a copy of the example and replace its public Firebase placeholders. No private keys belong in this file.", style="Hint.TLabel", wraplength=650).grid(row=6, column=1, columnspan=2, sticky="w", pady=(0, 8))
        deploy_row = ttk.Frame(body, style="Surface.TFrame")
        deploy_row.grid(row=5 if mode == "tenant" else 8, column=1, columnspan=2, sticky="w", pady=(0, 8))
        ttk.Checkbutton(deploy_row, text="Deploy registry rules" if mode == "register" else "Deploy tenant rules", variable=data["rules"]).pack(side="left")
        if mode == "tenant":
            ttk.Checkbutton(deploy_row, text="Deploy indexes", variable=data["indexes"]).pack(side="left", padx=16)
            ttk.Checkbutton(body, text="Add initial School Admin profile (existing Auth account)", variable=data["admin"], command=lambda: self._toggle_admin(mode)).grid(row=8, column=1, columnspan=2, sticky="w", pady=(8, 0))
            admin = data["admin_frame"] = ttk.Frame(body, style="Surface.TFrame")
            admin.columnconfigure(1, weight=1)
            admin.grid(row=9, column=0, columnspan=3, sticky="ew", pady=(8, 0))
            self._field(admin, 0, "Firebase Auth UID", data["uid"])
            self._field(admin, 1, "Admin email", data["email"])
            self._field(admin, 2, "Admin name", data["name"])
            admin.grid_remove()

    def _field(self, parent, row, label, variable, browse=None):
        ttk.Label(parent, text=label, style="Surface.TLabel").grid(row=row, column=0, sticky="w", padx=(0, 18), pady=(0, 9))
        ttk.Entry(parent, textvariable=variable).grid(row=row, column=1, sticky="ew", pady=(0, 9))
        if browse:
            ttk.Button(parent, text="Browse…", command=browse).grid(row=row, column=2, padx=(8, 0), pady=(0, 9))

    def _toggle_admin(self, mode):
        frame = self.inputs[mode]["admin_frame"]
        frame.grid() if self.inputs[mode]["admin"].get() else frame.grid_remove()

    def mode(self):
        return "register" if self.notebook.index(self.notebook.select()) == 0 else "tenant"

    def _options(self, preview=False):
        mode = self.mode()
        data = self.inputs[mode]
        service = data["service"].get().strip() or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
        return Options(
            mode=mode, project=data["project"].get().strip() or ("<project-id>" if preview else ""),
            source=Path(data["source"].get().strip()).expanduser().resolve(), service_account=Path(service).expanduser().resolve() if service else None,
            school_year=data["year"].get().strip(), deploy_rules=data["rules"].get(),
            deploy_indexes=mode == "tenant" and data["indexes"].get(),
            admin_uid=data["uid"].get().strip() if mode == "tenant" and data["admin"].get() else "",
            admin_email=data["email"].get().strip() if mode == "tenant" and data["admin"].get() else "",
            admin_name=data["name"].get().strip(),
        )

    def _changed(self, *_):
        if self.disposed:
            return
        if self.preview_timer:
            self.root.after_cancel(self.preview_timer)
        self.preview_timer = self.root.after(120, self._preview)

    def _preview(self):
        if self.preview_timer:
            self.root.after_cancel(self.preview_timer)
        self.preview_timer = None
        if self.busy:
            return
        try:
            command = command_for(self._options(preview=True), dry_run=self.dry_run.get(), entry=ENTRY, gui_control=True)
            self._text(self.command, display_command(command))
        except (OSError, ValueError):
            self._text(self.command, "Choose a valid JSON file path to preview the command.")
        self.run_button.configure(text="Run dry run" if self.dry_run.get() else "Review & provision…")
        self.status.set("Ready · local dry run selected" if self.dry_run.get() else "Live mode · target and summary will be reviewed before changes")

    def _browse(self, mode, kind):
        path = filedialog.askopenfilename(parent=self.root, title="Choose service-account key" if kind == "service" else "Choose provisioning JSON", filetypes=[("JSON files", "*.json"), ("All files", "*.*")])
        if path:
            self.inputs[mode][kind].set(path)

    def _export(self, mode):
        source = ASSETS / ("school-registration.example.json" if mode == "register" else "tenant-structure.json")
        path = filedialog.asksaveasfilename(parent=self.root, defaultextension=".json", initialfile=source.name, filetypes=[("JSON", "*.json")])
        if not path:
            return
        try:
            if Path(path).resolve().is_relative_to(ASSETS.resolve()):
                raise ProvisionError("Save a separate copy outside the bundled assets folder.")
            Path(path).write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
            self.inputs[mode]["source"].set(path)
        except (OSError, ProvisionError) as exc:
            messagebox.showerror("Cannot export", str(exc), parent=self.root)

    def _editor(self, mode):
        try:
            value, _ = read_json(Path(self.inputs[mode]["source"].get()).expanduser())
            reject_secrets(value)
        except ProvisionError as exc:
            messagebox.showerror("Cannot open JSON", str(exc), parent=self.root)
            return
        window = tk.Toplevel(self.root)
        window.title("Edit registration JSON" if mode == "register" else "Edit tenant structure JSON")
        window.geometry("800x620")
        window.transient(self.root)
        window.grab_set()
        ttk.Label(window, text="Edit public provisioning data, then save a separate JSON file.", padding=12).pack(anchor="w")
        frame = ttk.Frame(window, padding=(12, 0))
        frame.pack(fill="both", expand=True)
        editor = tk.Text(frame, wrap="none", font=("Consolas", 10), undo=True)
        scrollbar = ttk.Scrollbar(frame, command=editor.yview)
        scrollbar.pack(side="right", fill="y")
        editor.configure(yscrollcommand=scrollbar.set)
        editor.pack(side="left", fill="both", expand=True)
        editor.insert("1.0", json.dumps(value, indent=2, ensure_ascii=False))

        def save():
            raw = editor.get("1.0", "end-1c")
            try:
                parsed = json.loads(raw)
                if not isinstance(parsed, dict):
                    raise ProvisionError("JSON must contain one object.")
                reject_secrets(parsed)
                path = filedialog.asksaveasfilename(parent=window, defaultextension=".json", initialfile="school-registration.json" if mode == "register" else "tenant-structure.custom.json", filetypes=[("JSON", "*.json")])
                if not path:
                    return
                if Path(path).resolve().is_relative_to(ASSETS.resolve()):
                    raise ProvisionError("Save a separate copy outside the bundled assets folder.")
                # Keep the operator's text; strict duplicate-key validation occurs on run.
                Path(path).write_text(raw + "\n", encoding="utf-8")
                self.inputs[mode]["source"].set(path)
                window.destroy()
            except (ValueError, OSError, ProvisionError, RecursionError) as exc:
                messagebox.showerror("Cannot save JSON", str(exc) if not isinstance(exc, RecursionError) else "JSON nesting is too deep.", parent=window)

        ttk.Button(window, text="Save as…", command=save, style="Accent.TButton").pack(anchor="e", padx=12, pady=12)

    def _start(self):
        if self.busy:
            return
        try:
            plan = prepare_plan(self._options())
        except (ProvisionError, OSError, ValueError) as exc:
            self._log(f"VALIDATION: {exc}")
            messagebox.showerror("Review inputs", str(exc), parent=self.root)
            return
        dry = self.dry_run.get()
        if not dry and not messagebox.askyesno("Review provisioning", plan.summary() + "\n\nSelected rule deployment replaces the project's current rules. Database provisioning and deployment are separate steps.\n\nProceed with these changes?", parent=self.root, icon="warning"):
            return
        command = command_for(plan.options, dry_run=dry, entry=ENTRY, gui_control=True, source_hash=plan.source_hash)
        self._text(self.command, display_command(command))
        self.cancel_requested.clear()
        self._busy(True)
        self.status.set("Validating dry run…" if dry else f"Provisioning {plan.options.project}…")
        self._log("Starting offline dry run…" if dry else f"Starting LIVE operation for {plan.options.project}…")
        Thread(target=self._worker, args=(command,), daemon=True).start()

    def _worker(self, command):
        code = 1
        try:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True, encoding="utf-8", errors="replace", shell=False,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            with self.process_lock:
                self.process = process
            if self.cancel_requested.is_set():
                self._send_cancel()
            assert process.stdout is not None
            for line in process.stdout:
                self.events.put(("line", line.rstrip()))
            code = process.wait()
            process.stdout.close()
            if process.stdin:
                process.stdin.close()
        except OSError:
            self.events.put(("line", "ERROR: Could not start the Python provisioning process. Check the entry point and environment."))
        finally:
            with self.process_lock:
                self.process = None
            self.events.put(("done", code))

    def _busy(self, busy):
        self.busy = busy
        def set_children(widget):
            for child in widget.winfo_children():
                if isinstance(child, (ttk.Entry, ttk.Button, ttk.Checkbutton)):
                    child.state(["disabled"] if busy else ["!disabled"])
                set_children(child)
        for form in self.forms.values():
            set_children(form)
        for button in (self.run_button, self.dry_check, self.check_button):
            button.state(["disabled"] if busy else ["!disabled"])
        self.cancel_button.state(["!disabled"] if busy else ["disabled"])
        active = self.notebook.index(self.notebook.select())
        for index in (0, 1):
            self.notebook.tab(index, state="disabled" if busy and index != active else "normal")
        self.progress.start(12) if busy else self.progress.stop()

    def _send_cancel(self):
        with self.process_lock:
            process = self.process
            if process and process.stdin and process.poll() is None:
                try:
                    process.stdin.write("cancel\n")
                    process.stdin.flush()
                except (OSError, ValueError):
                    pass

    def _cancel(self):
        if not self.busy:
            return
        self.cancel_requested.set()
        self._send_cancel()
        self.cancel_button.state(["disabled"])
        self.status.set("Cancellation requested · waiting for any in-flight request to finish")
        self._log("Cancellation requested. Completed writes/deployments cannot be undone; in-flight requests have bounded timeouts.")

    def _poll(self):
        self.poll_timer = None
        for _ in range(150):
            try:
                kind, value = self.events.get_nowait()
            except queue.Empty:
                break
            if kind == "line":
                self._log(value)
            elif kind == "done":
                self._busy(False)
                self.status.set("Completed successfully" if value == 0 else "Stopped · review completed steps in the log" if value == 130 else "Failed · review the activity log")
                if self.closing:
                    self.shutdown()
                    return
        self.poll_timer = self.root.after(80, self._poll)

    @staticmethod
    def _text(widget, text):
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", text)
        widget.configure(state="disabled")

    def _log(self, text):
        stamp = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
        self.log_box.configure(state="normal")
        for line in str(text).splitlines():
            self.log_box.insert("end", f"{stamp}  {self.redactor.line(line)}\n")
        count = int(self.log_box.index("end-1c").split(".")[0])
        if count > 2000:
            self.log_box.delete("1.0", f"{count - 2000}.0")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def _clear_log(self):
        self._text(self.log_box, "")

    def _save_log(self):
        path = filedialog.asksaveasfilename(parent=self.root, initialfile="edash-provision.log", defaultextension=".log", filetypes=[("Log", "*.log")])
        if path:
            try:
                Path(path).write_text(self.log_box.get("1.0", "end-1c"), encoding="utf-8")
            except OSError:
                messagebox.showerror("Cannot save log", "Choose a writable file location.", parent=self.root)

    def _close(self):
        if self.busy:
            if messagebox.askyesno("Provisioning is running", "Request cancellation and close after the current request finishes? Completed remote changes are retained.", parent=self.root):
                self.closing = True
                self._cancel()
        else:
            self.shutdown()

    def shutdown(self):
        """Release scheduled Tk callbacks before destroying the interpreter."""
        self.disposed = True
        for name in ("preview_timer", "poll_timer", "layout_timer"):
            timer = getattr(self, name)
            if timer:
                self.root.after_cancel(timer)
                setattr(self, name, None)
        self.root.destroy()


def launch():
    root = tk.Tk()
    ProvisionApp(root)
    root.mainloop()
