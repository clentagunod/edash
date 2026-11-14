"""Responsive ttk interface. All remote work runs in a separate Python process."""

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
from .asset_reference import LOGO_REFERENCE_ERROR, VIDEO_REFERENCE_ERROR, normalize_asset_reference
from .cli import command_for, doctor
from .deployment import OutputRedactor, display_command
from .models import ASSETS, Options, ProvisionError
from .validation import _unique_object, prepare_plan, read_json, reject_secrets

BG = "#f3f6f8"
INK = "#172b3a"
MUTED = "#617381"
ACCENT = "#087f74"
ENTRY = Path(__file__).resolve().parents[2] / "main.py"


def fit_window(window, width, height, minimum=(420, 420)):
    """Keep the initial window and its minimum size inside the desktop work area."""
    left, top = 0, 0
    right, bottom = window.winfo_screenwidth(), window.winfo_screenheight()
    if os.name == "nt":
        import ctypes
        from ctypes.wintypes import RECT
        area = RECT()
        if ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(area), 0):
            left, top, right, bottom = area.left, area.top, area.right, area.bottom
    available_width = max(1, right - left - 32)
    available_height = max(1, bottom - top - 64)
    width, height = min(width, available_width), min(height, available_height)
    window.minsize(min(minimum[0], available_width), min(minimum[1], available_height))
    window.geometry(f"{width}x{height}+{left + (right - left - width) // 2}+{top + max(8, (bottom - top - height) // 2 - 16)}")
    return available_width, available_height


class FlowFrame(ttk.Frame):
    """Wrap a short group of buttons or options onto additional rows as needed."""

    def __init__(self, parent, **kwargs):
        super().__init__(parent, **kwargs)
        self.bind("<Configure>", self.reflow)

    def reflow(self, _=None):
        width = self.winfo_width()
        x, row, column = 0, 0, 0
        for child in self.winfo_children():
            needed = child.winfo_reqwidth() + 6
            if column and x + needed > width:
                x, column, row = 0, 0, row + 1
            child.grid(row=row, column=column, sticky="w", padx=(0, 6), pady=2)
            x += needed
            column += 1


class FormField(ttk.Frame):
    """Put labels above their inputs when a full form row would be too narrow."""

    def __init__(self, parent, label, variable, browse=None):
        super().__init__(parent, style="Surface.TFrame")
        self.label = ttk.Label(self, text=label, style="Surface.TLabel", width=19)
        self.control = ttk.Frame(self, style="Surface.TFrame")
        self.control.columnconfigure(0, weight=1)
        self.entry = ttk.Entry(self.control, textvariable=variable, width=1)
        self.entry.grid(row=0, column=0, sticky="ew")
        self.browse = None
        if browse:
            self.browse = ttk.Button(self.control, text="Browse…", command=browse)
            self.browse.grid(row=0, column=1, padx=(8, 0))
        self.bind("<Configure>", self.reflow)

    def reflow(self, _=None):
        # Use font-dependent requested widths so larger text also triggers stacking.
        needed = self.label.winfo_reqwidth() + self.entry.winfo_reqheight() * 8 + 24
        if self.browse:
            needed += self.browse.winfo_reqwidth() + 8
        stacked = self.winfo_width() < needed
        self.columnconfigure(0, weight=1 if stacked else 0)
        self.columnconfigure(1, weight=0 if stacked else 1)
        self.label.grid(row=0, column=0, sticky="w", padx=(0, 0 if stacked else 16), pady=(0, 4 if stacked else 0))
        self.control.grid(row=1 if stacked else 0, column=0 if stacked else 1, sticky="ew")


class ScrollForm(ttk.Frame):
    def __init__(self, parent):
        super().__init__(parent, style="Surface.TFrame")
        self.canvas = tk.Canvas(self, width=1, height=1, background="white", highlightthickness=0,
                                borderwidth=0, yscrollincrement=18)
        scrollbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.body = ttk.Frame(self.canvas, padding=(16, 14), style="Surface.TFrame")
        self.body.columnconfigure(0, weight=1)
        item = self.canvas.create_window(0, 0, anchor="nw", window=self.body)
        self.body.bind("<Configure>", self._body_changed)
        self.canvas.bind("<Configure>", lambda event: self.canvas.itemconfigure(item, width=event.width))

    def enable_scrolling(self):
        def bind_children(widget):
            widget.bind("<MouseWheel>", self._wheel, add="+")
            widget.bind("<Button-4>", self._wheel, add="+")
            widget.bind("<Button-5>", self._wheel, add="+")
            widget.bind("<FocusIn>", lambda event: self.see(event.widget), add="+")
            for child in widget.winfo_children():
                bind_children(child)
        bind_children(self)

    def _body_changed(self, _):
        def wrap_hints(parent):
            for child in parent.winfo_children():
                if isinstance(child, ttk.Label) and child.cget("style") == "Hint.TLabel":
                    child.configure(wraplength=max(1, parent.winfo_width() - 32))
                wrap_hints(child)
        wrap_hints(self.body)
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def _wheel(self, event):
        if self.canvas.yview() == (0.0, 1.0):
            return
        if getattr(event, "num", None) in (4, 5):
            units = -1 if event.num == 4 else 1
        elif event.delta:
            units = -int(event.delta / 120) if abs(event.delta) >= 120 else (-1 if event.delta > 0 else 1)
        else:
            return
        self.canvas.yview_scroll(units, "units")
        return "break"

    def see(self, widget):
        """Keep keyboard focus and newly expanded options inside the viewport."""
        if not widget.winfo_ismapped():
            return
        height = max(1, self.body.winfo_height())
        y = widget.winfo_rooty() - self.body.winfo_rooty()
        view_top = self.canvas.canvasy(0)
        view_height = self.canvas.winfo_height()
        if y < view_top or widget.winfo_height() > view_height:
            self.canvas.yview_moveto(max(0, y - 8) / height)
        elif y + widget.winfo_height() > view_top + view_height:
            self.canvas.yview_moveto((y + widget.winfo_height() - view_height + 8) / height)


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
        self.desktop_size = fit_window(root, 940, 680)
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
        self.sash_timer = None
        self.orientation = None
        self.output_visible = True
        self.output_requested = True
        self.compact = False
        self.compact_show_output = False
        self.pane_extent = None
        self.sash_ratios = {"horizontal": 0.57, "vertical": 0.68}
        self.forms = {}
        self.inputs = {}
        self.text_size = tk.StringVar(value="100%")
        self.dry_run = tk.BooleanVar(value=True)
        self._style()
        self._layout()
        self.root.bind("<Configure>", self._queue_layout, add="+")
        self.root.bind("<Control-plus>", lambda _: self._zoom(1))
        self.root.bind("<Control-equal>", lambda _: self._zoom(1))
        self.root.bind("<Control-minus>", lambda _: self._zoom(-1))
        self.root.bind("<Control-0>", lambda _: self._set_text_size("100%"))
        self.dry_run.trace_add("write", self._changed)
        self.notebook.bind("<<NotebookTabChanged>>", self._changed)
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self.poll_timer = self.root.after(100, self._poll)
        self._preview()
        self._log(f"Edash Provision {__version__} · Python {sys.version.split()[0]} · environment {Path(sys.prefix).name}")
        self._log("Choose a mode and target project. Dry run validates locally and never connects to Firebase.")

    def _style(self):
        self.scale = int(self.text_size.get().rstrip("%")) / 100
        def size(points):
            return max(8, round(points * self.scale))
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure(".", font=("Segoe UI", size(10)), background=BG, foreground=INK)
        style.configure("TFrame", background=BG)
        style.configure("Surface.TFrame", background="white")
        style.configure("Surface.TLabel", background="white")
        style.configure("Muted.TLabel", foreground=MUTED)
        style.configure("Hint.TLabel", foreground=MUTED, background="white", font=("Segoe UI", size(9)))
        style.configure("Heading.TLabel", font=("Segoe UI Semibold", size(18)))
        style.configure("Section.TLabel", font=("Segoe UI Semibold", size(10)), background="white", foreground=ACCENT)
        style.configure("TButton", padding=(10, 5), borderwidth=1, relief="flat", background="white")
        style.map("TButton", background=[("active", "#e5efed")], foreground=[("disabled", "#8b979f")])
        style.configure("Accent.TButton", background=ACCENT, foreground="white", borderwidth=0)
        style.map("Accent.TButton", background=[("disabled", "#9fbab6"), ("active", "#06695f")], foreground=[("disabled", "white")])
        style.configure("TEntry", padding=5, fieldbackground="white", bordercolor="#d5dfe5")
        style.configure("TCheckbutton", background="white", padding=(0, 4))
        style.configure("Footer.TCheckbutton", background=BG)
        style.configure("TNotebook", borderwidth=0, background=BG)
        style.configure("TNotebook.Tab", padding=(12, 7), background="#e3eaee", borderwidth=0)
        style.map("TNotebook.Tab", background=[("selected", "white")], foreground=[("selected", ACCENT)])
        style.configure("Horizontal.TProgressbar", background=ACCENT, troughcolor="#dfe8eb", borderwidth=0, thickness=3)

    def _layout(self):
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)
        header = ttk.Frame(self.root, padding=(16, 12, 16, 10))
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)
        self.heading = ttk.Label(header, text="Edash Provision", style="Heading.TLabel")
        self.heading.grid(row=0, column=0, sticky="w")
        self.version_label = ttk.Label(header, text=f"v{__version__}", style="Muted.TLabel")
        self.version_label.grid(row=0, column=1, sticky="e")
        self.subtitle = ttk.Label(header, text="School registration & tenant database setup", style="Muted.TLabel")
        self.subtitle.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(0, 6))
        toolbar = ttk.Frame(header)
        toolbar.grid(row=2, column=0, columnspan=2, sticky="ew")
        toolbar.columnconfigure(2, weight=1)
        ttk.Label(toolbar, text="Text size", style="Muted.TLabel").grid(row=0, column=0, padx=(0, 6))
        self.size_picker = ttk.Combobox(toolbar, textvariable=self.text_size, values=("85%", "100%", "115%", "130%", "150%"), width=5, state="readonly")
        self.size_picker.grid(row=0, column=1)
        self.size_picker.bind("<<ComboboxSelected>>", lambda _: self._set_text_size(self.text_size.get()))
        self.output_button = ttk.Button(toolbar, text="Hide output", command=self._toggle_output)
        self.output_button.grid(row=0, column=3, sticky="e")

        self.content = ttk.Frame(self.root, padding=(16, 0))
        self.content.grid(row=1, column=0, sticky="nsew")
        self.content.columnconfigure(0, weight=1)
        self.content.rowconfigure(0, weight=1)
        self.panes = tk.PanedWindow(self.content, orient="vertical", background=BG, borderwidth=0,
                                    sashwidth=8, sashrelief="flat", showhandle=False, opaqueresize=True)
        self.panes.grid(row=0, column=0, sticky="nsew")
        self.panes.bind("<Configure>", lambda _: self._queue_layout())
        self.panes.bind("<ButtonRelease-1>", self._remember_sash)
        self.form_panel = ttk.Frame(self.panes)
        self.panes.add(self.form_panel, minsize=100, stretch="always")
        self.notebook = ttk.Notebook(self.form_panel)
        self.notebook.pack(fill="both", expand=True)
        for mode, label in (("register", "Registration"), ("tenant", "Tenant provision")):
            form = ScrollForm(self.notebook)
            self.forms[mode] = form
            self.notebook.add(form, text=label)
            self._form(mode, form.body)
            form.enable_scrolling()

        self.output_panel = ttk.Frame(self.panes)
        self.panes.add(self.output_panel, minsize=100, stretch="always")
        self.output_notebook = ttk.Notebook(self.output_panel)
        self.output_notebook.pack(fill="both", expand=True)
        activity = ttk.Frame(self.output_notebook)
        command_panel = ttk.Frame(self.output_notebook)
        self.output_notebook.add(activity, text="Activity log")
        self.output_notebook.add(command_panel, text="Command preview")

        log_header = FlowFrame(activity)
        log_header.pack(fill="x", pady=(3, 4))
        self.check_button = ttk.Button(log_header, text="Check tools", command=lambda: doctor(self._log))
        ttk.Button(log_header, text="Save log", command=self._save_log)
        ttk.Button(log_header, text="Clear", command=self._clear_log)
        log_frame = ttk.Frame(activity)
        log_frame.pack(fill="both", expand=True)
        self.log_box = tk.Text(log_frame, width=1, height=1, wrap="word", background="#152a36", foreground="#dcebe9",
                               font=("Consolas", 10), relief="flat", padx=10, pady=8, state="disabled")
        scrollbar = ttk.Scrollbar(log_frame, command=self.log_box.yview)
        self.log_box.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.log_box.pack(side="left", fill="both", expand=True)

        ttk.Button(command_panel, text="Copy command", command=self._copy_command).pack(anchor="e", pady=(3, 5))
        command_frame = ttk.Frame(command_panel)
        command_frame.pack(fill="both", expand=True)
        self.command = tk.Text(command_frame, width=1, height=1, wrap="word", background="#e8eef1", foreground=INK,
                               font=("Consolas", 10), relief="flat", padx=10, pady=8, state="disabled")
        command_scroll = ttk.Scrollbar(command_frame, command=self.command.yview)
        self.command.configure(yscrollcommand=command_scroll.set)
        command_scroll.pack(side="right", fill="y")
        self.command.pack(side="left", fill="both", expand=True)

        self.actions = ttk.Frame(self.root, padding=(16, 8, 16, 4))
        self.actions.grid(row=2, column=0, sticky="ew")
        self.actions.columnconfigure(0, weight=1)
        self.dry_check = ttk.Checkbutton(self.actions, text="Dry run · no remote changes", variable=self.dry_run, style="Footer.TCheckbutton")
        self.action_buttons = ttk.Frame(self.actions)
        self.cancel_button = ttk.Button(self.action_buttons, text="Cancel", command=self._cancel, state="disabled")
        self.cancel_button.pack(side="left", padx=(0, 8))
        self.run_button = ttk.Button(self.action_buttons, text="Run dry run", command=self._start, style="Accent.TButton")
        self.run_button.pack(side="left")
        footer = ttk.Frame(self.root, padding=(16, 0, 16, 10))
        footer.grid(row=3, column=0, sticky="ew")
        footer.columnconfigure(0, weight=1)
        self.progress = ttk.Progressbar(footer, mode="indeterminate")
        self.progress.grid(row=0, column=0, sticky="ew", pady=(2, 5))
        self.status = tk.StringVar(value="Ready · local dry run selected")
        self.status_label = ttk.Label(footer, textvariable=self.status, style="Muted.TLabel", wraplength=300)
        self.status_label.grid(row=1, column=0, sticky="ew")
        self._set_text_size("100%")

    def _queue_layout(self, event=None):
        if event is not None and event.widget != self.root:
            return
        if not self.disposed and self.layout_timer is None:
            self.layout_timer = self.root.after_idle(self._responsive_layout)

    def _responsive_layout(self):
        self.layout_timer = None
        width = max(1, self.root.winfo_width() - 32)
        self.heading.configure(wraplength=max(1, width - self.version_label.winfo_reqwidth() - 12))
        self.subtitle.configure(wraplength=width)
        self.status_label.configure(wraplength=width)
        stacked = width < self.dry_check.winfo_reqwidth() + self.action_buttons.winfo_reqwidth() + 16
        self.dry_check.grid(row=0, column=0, sticky="w")
        self.action_buttons.grid(row=1 if stacked else 0, column=0 if stacked else 1,
                                 sticky="e", pady=(4 if stacked else 0, 0))
        orientation = "horizontal" if width >= 1080 * self.scale else "vertical"
        changed = orientation != self.orientation
        self.orientation = orientation
        self.panes.configure(orient=orientation)
        compact = orientation == "vertical" and self.panes.winfo_height() < round(300 * self.scale)
        if compact != self.compact:
            self.compact_show_output = False
        self.compact = compact
        self._arrange_panels()
        extent = self.panes.winfo_width() if orientation == "horizontal" else self.panes.winfo_height()
        if changed or extent != self.pane_extent:
            self._queue_sash()
        self.pane_extent = extent

    def _arrange_panels(self):
        # On short windows use the whole workspace for either setup or output.
        self.output_visible = self.compact_show_output if self.compact else self.output_requested
        panels = [] if self.compact and self.output_visible else [self.form_panel]
        if self.output_visible:
            panels.append(self.output_panel)
        if tuple(str(panel) for panel in panels) != tuple(str(panel) for panel in self.panes.panes()):
            for panel in self.panes.panes():
                self.panes.forget(panel)
            for panel in panels:
                self.panes.add(panel, minsize=self._pane_minimum(panel), stretch="always")
            self._queue_sash()
        for panel in panels:
            minimum = self._pane_minimum(panel)
            if int(self.panes.panecget(panel, "minsize")) != minimum:
                self.panes.paneconfigure(panel, minsize=minimum)
        text = "Back to setup" if self.compact and self.output_visible else "Hide output" if self.output_visible else "Show output"
        self.output_button.configure(text=text)

    def _pane_minimum(self, panel):
        form = panel == self.form_panel
        base = (360 if form else 320) if self.orientation == "horizontal" else (130 if form else 120)
        return round(base * self.scale)

    def _queue_sash(self):
        if self.sash_timer:
            self.root.after_cancel(self.sash_timer)
        self.sash_timer = self.root.after_idle(self._place_sash)

    def _place_sash(self):
        self.sash_timer = None
        if len(self.panes.panes()) == 2:
            horizontal = self.orientation == "horizontal"
            extent = self.panes.winfo_width() if horizontal else self.panes.winfo_height()
            position = max(
                self._pane_minimum(self.form_panel),
                min(extent - self._pane_minimum(self.output_panel) - 8,
                    int(extent * self.sash_ratios[self.orientation])),
            )
            self.panes.sash_place(0, position if horizontal else 0, 0 if horizontal else position)

    def _remember_sash(self, _):
        if len(self.panes.panes()) == 2:
            horizontal = self.orientation == "horizontal"
            extent = self.panes.winfo_width() if horizontal else self.panes.winfo_height()
            self.sash_ratios[self.orientation] = self.panes.sash_coord(0)[0 if horizontal else 1] / max(1, extent)

    def _toggle_output(self):
        if self.compact:
            self.compact_show_output = not self.compact_show_output
        else:
            self.output_requested = not self.output_requested
        self._arrange_panels()

    def _set_text_size(self, value):
        self.text_size.set(value)
        self._style()
        # Reserve enough height for navigation and one useful viewport at large text sizes.
        self.root.minsize(min(420, self.desktop_size[0]),
                          min(self.desktop_size[1], max(420, round(420 + (self.scale - 1) * 180))))
        font = ("Segoe UI", max(8, round(10 * self.scale)))
        self.size_picker.configure(font=font)
        def refresh(widget):
            if isinstance(widget, ttk.Entry):
                widget.configure(font=font)
            elif isinstance(widget, tk.Text):
                widget.configure(font=("Consolas", max(8, round(10 * self.scale))))
            for child in widget.winfo_children():
                refresh(child)
            if isinstance(widget, (FormField, FlowFrame)):
                widget.reflow()
        refresh(self.root)
        self._queue_layout()

    def _zoom(self, direction):
        values = list(self.size_picker.cget("values"))
        index = values.index(self.text_size.get())
        self._set_text_size(values[max(0, min(len(values) - 1, index + direction))])
        return "break"

    def _copy_command(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.command.get("1.0", "end-1c"))

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
        row = 0

        def add(widget, gap=8):
            nonlocal row
            widget.grid(row=row, column=0, sticky="ew", pady=(0, gap))
            row += 1
            return widget

        def hint(text):
            return add(ttk.Label(body, text=text, style="Hint.TLabel", wraplength=300))

        def section(text):
            return add(ttk.Label(body, text=text, style="Section.TLabel"), gap=6)

        hint(note)
        section("Target project")
        add(FormField(body, "Central project ID" if mode == "register" else "Tenant project ID", data["project"]))
        if mode == "tenant":
            add(FormField(body, "School year", data["year"]))
        add(FormField(body, "Service key JSON", data["service"], lambda: self._browse(mode, "service")), gap=4)
        hint("Use this project's service-account key, or leave blank for Application Default Credentials.")
        section("Provisioning data")
        add(FormField(body, "Registration JSON" if mode == "register" else "Structure JSON", data["source"], lambda: self._browse(mode, "source")), gap=4)
        tools = add(FlowFrame(body, style="Surface.TFrame"))
        ttk.Button(tools, text="Edit JSON…", command=lambda: self._editor(mode))
        ttk.Button(tools, text="Export example…" if mode == "register" else "Export structure…", command=lambda: self._export(mode))
        if mode == "tenant":
            ttk.Button(tools, text="Use default", command=lambda: data["source"].set(str(ASSETS / "tenant-structure.json")))
        else:
            hint("Edit a copy of the example and replace its public Firebase placeholders. No private keys belong in this file.")
            hint("Logo and video: use public/assets/school/filename, assets/school/filename, or an HTTPS URL. Website paths resolve from the public folder; videoUrl may be empty.")
        section("Optional setup")
        deploy_row = add(FlowFrame(body, style="Surface.TFrame"))
        ttk.Checkbutton(deploy_row, text="Deploy registry rules" if mode == "register" else "Deploy tenant rules", variable=data["rules"])
        if mode == "tenant":
            ttk.Checkbutton(deploy_row, text="Deploy indexes", variable=data["indexes"])
            add(ttk.Checkbutton(body, text="Add initial School Admin", variable=data["admin"], command=lambda: self._toggle_admin(mode)), gap=2)
            hint("Use an existing Firebase Authentication account. This adds its Firestore profile only.")
            admin = data["admin_frame"] = add(ttk.Frame(body, style="Surface.TFrame"))
            admin.columnconfigure(0, weight=1)
            self._field(admin, 0, "Firebase Auth UID", data["uid"])
            self._field(admin, 1, "Admin email", data["email"])
            self._field(admin, 2, "Admin name", data["name"])
            admin.grid_remove()

    def _field(self, parent, row, label, variable, browse=None):
        FormField(parent, label, variable, browse).grid(row=row, column=0, sticky="ew", pady=(0, 8))

    def _toggle_admin(self, mode):
        frame = self.inputs[mode]["admin_frame"]
        frame.grid() if self.inputs[mode]["admin"].get() else frame.grid_remove()
        if self.inputs[mode]["admin"].get():
            # Let the scroll region grow before bringing the expanded fields into view.
            self.forms[mode].update_idletasks()
            self.forms[mode].see(frame)

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
        self._queue_layout()

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
        fit_window(window, 780, 560, minimum=(420, 320))
        window.transient(self.root)
        window.grab_set()
        window.columnconfigure(0, weight=1)
        window.rowconfigure(1, weight=1)
        guidance = "Edit public provisioning data, then save a separate JSON file."
        if mode == "register":
            guidance += "\nLogo and video accept public/assets/school/filename, assets/school/filename, or an HTTPS URL. Paths are normalized when saved; videoUrl may be empty."
        note = ttk.Label(window, text=guidance, padding=12, wraplength=360)
        note.grid(row=0, column=0, sticky="ew")
        window.bind("<Configure>", lambda event: note.configure(wraplength=max(1, event.width - 24)) if event.widget == window else None)
        frame = ttk.Frame(window, padding=(12, 0))
        frame.grid(row=1, column=0, sticky="nsew")
        frame.columnconfigure(0, weight=1)
        frame.rowconfigure(0, weight=1)
        editor = tk.Text(frame, width=1, height=1, wrap="none", font=("Consolas", max(8, round(10 * self.scale))), undo=True)
        scrollbar = ttk.Scrollbar(frame, command=editor.yview)
        horizontal = ttk.Scrollbar(frame, orient="horizontal", command=editor.xview)
        editor.configure(yscrollcommand=scrollbar.set, xscrollcommand=horizontal.set)
        scrollbar.grid(row=0, column=1, sticky="ns")
        horizontal.grid(row=1, column=0, sticky="ew")
        editor.grid(row=0, column=0, sticky="nsew")
        editor.insert("1.0", json.dumps(value, indent=2, ensure_ascii=False))

        def save():
            raw = editor.get("1.0", "end-1c")
            try:
                parsed = json.loads(raw, object_pairs_hook=_unique_object)
                if not isinstance(parsed, dict):
                    raise ProvisionError("JSON must contain one object.")
                reject_secrets(parsed)
                if mode == "register":
                    logo = normalize_asset_reference(parsed.get("logoUrl"))
                    if logo is None:
                        raise ProvisionError(LOGO_REFERENCE_ERROR)
                    video_value = parsed.get("videoUrl", "")
                    if not isinstance(video_value, str):
                        raise ProvisionError(VIDEO_REFERENCE_ERROR)
                    video = normalize_asset_reference(video_value) if video_value.strip() else ""
                    if video is None:
                        raise ProvisionError(VIDEO_REFERENCE_ERROR)
                    if parsed["logoUrl"] != logo or video_value != video:
                        parsed["logoUrl"] = logo
                        parsed["videoUrl"] = video
                        raw = json.dumps(parsed, indent=2, ensure_ascii=False)
                path = filedialog.asksaveasfilename(parent=window, defaultextension=".json", initialfile="school-registration.json" if mode == "register" else "tenant-structure.custom.json", filetypes=[("JSON", "*.json")])
                if not path:
                    return
                if Path(path).resolve().is_relative_to(ASSETS.resolve()):
                    raise ProvisionError("Save a separate copy outside the bundled assets folder.")
                # Preserve the operator's text unless a media path needed normalization.
                Path(path).write_text(raw + "\n", encoding="utf-8")
                self.inputs[mode]["source"].set(path)
                window.destroy()
            except (ValueError, OSError, ProvisionError, RecursionError) as exc:
                messagebox.showerror("Cannot save JSON", str(exc) if not isinstance(exc, RecursionError) else "JSON nesting is too deep.", parent=window)

        ttk.Button(window, text="Save as…", command=save, style="Accent.TButton").grid(row=2, column=0, sticky="e", padx=12, pady=12)

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
        if not self.output_visible:
            self._toggle_output()
        self.output_notebook.select(0)
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
        for name in ("preview_timer", "poll_timer", "layout_timer", "sash_timer"):
            timer = getattr(self, name)
            if timer:
                self.root.after_cancel(timer)
                setattr(self, name, None)
        self.root.destroy()


def launch():
    root = tk.Tk()
    ProvisionApp(root)
    root.mainloop()
