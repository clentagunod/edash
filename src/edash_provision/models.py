"""Shared immutable inputs and provisioning plans."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

ASSETS = Path(__file__).resolve().parent / "assets"


class ProvisionError(Exception):
    """An operator-readable error that contains no credential material."""


class Cancelled(ProvisionError):
    """Cooperative cancellation; completed remote operations are not undone."""


@dataclass(frozen=True)
class Options:
    mode: Literal["register", "tenant"]
    project: str
    source: Path
    service_account: Path | None = None
    school_year: str = "2026-2027"
    deploy_rules: bool = False
    deploy_indexes: bool = False
    admin_uid: str = ""
    admin_email: str = ""
    admin_name: str = "School Administrator"


@dataclass(frozen=True)
class Document:
    path: str
    data: dict[str, Any]


@dataclass(frozen=True)
class Plan:
    options: Options
    documents: tuple[Document, ...]
    source_hash: str
    rules: str | None = None
    indexes: dict[str, Any] | None = None
    collection_paths: tuple[str, ...] = ()

    @property
    def targets(self) -> tuple[str, ...]:
        return tuple(name for name, enabled in (
            ("firestore:rules", self.options.deploy_rules),
            ("firestore:indexes", self.options.deploy_indexes),
        ) if enabled)

    def summary(self) -> str:
        policy = "Merge supplied fields; preserve omitted fields" if self.options.mode == "register" else "Create missing documents; preserve existing documents"
        lines = [
            f"Mode: {'Registration' if self.options.mode == 'register' else 'Tenant provision'}",
            f"Project: {self.options.project} / (default) database",
            f"Policy: {policy}",
            f"Document candidates: {len(self.documents)}",
            f"Deployment: {', '.join(self.targets) or 'None'}",
        ]
        if self.options.mode == "tenant":
            lines.append(f"School year: {self.options.school_year} (existing current year is retained)")
        lines.extend(f"  {'MERGE' if self.options.mode == 'register' else 'CREATE IF MISSING'}  {doc.path}" for doc in self.documents)
        if self.collection_paths:
            lines.append(f"Logical collection paths: {len(self.collection_paths)}; no placeholder records are created.")
        return "\n".join(lines)
