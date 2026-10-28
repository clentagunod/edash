"""Offline validation and plan construction. This module never authenticates or writes."""

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from .codec import SERVER_TIMESTAMP, make_write
from .models import ASSETS, Document, Options, Plan, ProvisionError

MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_DOCUMENTS = 400
PROJECT_PATTERN = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]")
SECRET_KEYS = {"privatekey", "privatekeyid", "clientsecret", "refreshtoken", "accesstoken", "password", "serviceaccount", "serviceaccountjson"}


def _unique_object(pairs: list) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ProvisionError("JSON contains a duplicate object key. Remove the ambiguous duplicate.")
        result[key] = value
    return result


def read_json(path: Path, limit: int = MAX_JSON_BYTES) -> tuple[dict, str]:
    try:
        with path.open("rb") as stream:
            raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise ProvisionError(f"JSON file exceeds the {limit // 1024:,} KB limit.")
        value = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=_unique_object,
                           parse_constant=lambda _: (_ for _ in ()).throw(ProvisionError("Non-finite JSON numbers are not supported.")))
    except (OSError, UnicodeError) as exc:
        raise ProvisionError(f"Cannot read {path.name}. Choose a readable UTF-8 JSON file.") from exc
    except json.JSONDecodeError as exc:
        raise ProvisionError(f"Invalid JSON in {path.name}, line {exc.lineno}, column {exc.colno}.") from exc
    except RecursionError as exc:
        raise ProvisionError("JSON nesting is too deep.") from exc
    if not isinstance(value, dict):
        raise ProvisionError("The JSON file must contain one object.")
    return value, hashlib.sha256(raw).hexdigest()


def validate_project(project: str) -> str:
    if not PROJECT_PATTERN.fullmatch(project):
        raise ProvisionError("Project ID must be 6–30 lowercase letters, digits, or hyphens; start with a letter and end with a letter/digit.")
    return project


def validate_year(year: str) -> str:
    match = re.fullmatch(r"(\d{4})-(\d{4})", year)
    if not match or int(match[2]) != int(match[1]) + 1:
        raise ProvisionError("School year must contain consecutive years, for example 2026-2027.")
    return year


def validate_document_path(path: str) -> str:
    parts = path.split("/")
    if len(parts) % 2 or len(parts) > 100 or any(
        not part or part in {".", ".."} or re.fullmatch(r"__.*__", part) or len(part.encode("utf-8")) > 1500
        or any(ord(char) < 32 for char in part) for part in parts
    ):
        raise ProvisionError("Document paths must use collection/document pairs without empty, reserved, or traversal segments.")
    return path


def reject_secrets(value, depth: int = 0) -> None:
    if depth > 20:
        raise ProvisionError("JSON nesting exceeds 20 levels.")
    if isinstance(value, dict):
        for key, item in value.items():
            if re.sub(r"[^a-z]", "", key.lower()) in SECRET_KEYS:
                raise ProvisionError("Provisioning data contains a credential/password field. Choose the service key separately; do not write secrets to Firestore.")
            reject_secrets(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            reject_secrets(item, depth + 1)
    elif isinstance(value, str) and re.search(r"-----BEGIN [A-Z ]*PRIVATE KEY-----", value):
        raise ProvisionError("A private key was found in provisioning data. Choose a public registration or structure JSON instead.")


def _text(value: dict, key: str, maximum: int, *, required: bool = False) -> str:
    item = value.get(key, "")
    if not isinstance(item, str) or len(item) > maximum or (required and not item.strip()):
        raise ProvisionError(f"{key} must be {'a nonempty string' if required else 'a string'} of at most {maximum} characters.")
    return item.strip()


def _safe_url(value: str, asset: bool = False) -> bool:
    if asset and value.startswith("/") and not value.startswith("//") and "\\" not in value:
        return True
    try:
        parsed = urlsplit(value)
        return parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and not parsed.password and not any(c.isspace() for c in value)
    except ValueError:
        return False


def validate_registration(value: dict, central_project: str) -> Document:
    reject_secrets(value)
    result = deepcopy(value)
    school_id = _text(result, "id", 63, required=True)
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,62}", school_id):
        raise ProvisionError("School id must be 2–63 lowercase letters, digits, or hyphens.")
    for key, limit in (("name", 120), ("nickname", 64)):
        result[key] = _text(result, key, limit, required=True)
    if "tagline" in result:
        result["tagline"] = _text(result, "tagline", 240)
    if "projectName" in result:
        result["projectName"] = _text(result, "projectName", 120)
    if "canUseEduAI" in result and not isinstance(result["canUseEduAI"], bool):
        raise ProvisionError("canUseEduAI must be a JSON boolean.")
    if "colorGradientTag" in result and (not isinstance(result["colorGradientTag"], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", result["colorGradientTag"])):
        raise ProvisionError("colorGradientTag must be a six-digit hex color, for example #50A61E.")
    for key in ("logoUrl", "videoUrl"):
        if key not in result:
            raise ProvisionError(f"{key} is required (videoUrl may be empty).")
        result[key] = _text(result, key, 2048, required=key == "logoUrl")
        if result[key] and not _safe_url(result[key], asset=True):
            raise ProvisionError(f"{key} must be a same-site /path or an HTTPS URL.")
    for key, children in (("schoolInfo", ("region", "divisionOffice", "district")), ("schoolHead", ("name", "position", "email", "phoneNumber"))):
        if key in result:
            if not isinstance(result[key], dict):
                raise ProvisionError(f"{key} must be an object.")
            for child in children:
                if child not in result[key]:
                    raise ProvisionError(f"{key}.{child} is required when {key} is supplied; use an empty string if unavailable.")
                result[key][child] = _text(result[key], child, 160)
    config = result.get("firebaseConfig")
    if not isinstance(config, dict):
        raise ProvisionError("firebaseConfig must contain the tenant's public Firebase Web App configuration.")
    for key in ("apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"):
        config[key] = _text(config, key, 2048, required=True)
        if re.search(r"PUBLIC_|YOUR_|REPLACE_|<|>", config[key], re.I):
            raise ProvisionError(f"Replace the firebaseConfig.{key} example placeholder with the tenant's public Web App value.")
    validate_project(config["projectId"])
    if config["projectId"] == central_project:
        raise ProvisionError("Registration targets the central project; firebaseConfig.projectId must identify the separate tenant project.")
    for key in ("auditLogApiUrl", "feedbackApiUrl"):
        if key in result:
            result[key] = _text(result, key, 2048)
            if result[key] and not _safe_url(result[key]):
                raise ProvisionError(f"{key} must be empty or an HTTPS URL.")
    result.pop("id", None)
    result["enabled"] = True
    result["updatedAt"] = deepcopy(SERVER_TIMESTAMP)
    if "schoolHead" in result:
        result["schoolHead"]["updatedAt"] = deepcopy(SERVER_TIMESTAMP)
    return Document(f"schools/{school_id}", result)


def _substitute(value, year: str):
    if isinstance(value, str):
        result = value.replace("${schoolYear}", year)
        if re.search(r"\$\{[^}]*\}", result):
            raise ProvisionError("Only the ${schoolYear} template variable is supported.")
        return result
    if isinstance(value, list):
        return [_substitute(item, year) for item in value]
    if isinstance(value, dict):
        return {key: _substitute(item, year) for key, item in value.items()}
    return value


def validate_structure(value: dict, options: Options) -> tuple[tuple[Document, ...], tuple[str, ...]]:
    reject_secrets(value)
    if value.get("format") != "edash-tenant-provision" or type(value.get("version")) is not int or value["version"] != 1:
        raise ProvisionError('Structure must use format "edash-tenant-provision", version 1. Export the built-in template for an example.')
    entries = value.get("documents")
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_DOCUMENTS:
        raise ProvisionError(f"Structure must contain 1–{MAX_DOCUMENTS} document entries.")
    documents = []
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"path", "data"} or not isinstance(entry["path"], str) or not isinstance(entry["data"], dict):
            raise ProvisionError("Each structure document must contain exactly path (string) and data (object). Deletes and executable operations are not supported.")
        path = validate_document_path(_substitute(entry["path"], options.school_year))
        if path in seen:
            raise ProvisionError(f"Duplicate document path: {path}.")
        seen.add(path)
        data = _substitute(entry["data"], options.school_year)
        if len(path.split("/")) == 2 and path.startswith("users/"):
            preferences = data.get("teacherPrefs", {})
            if not isinstance(preferences, dict):
                raise ProvisionError("User teacherPrefs must be an object.")
            data["teacherPrefs"] = {**deepcopy(read_json(ASSETS / "user-preferences.json")[0]), **preferences}
        documents.append(Document(path, data))
    if options.admin_uid or options.admin_email:
        if not options.admin_uid or "/" in options.admin_uid or len(options.admin_uid) > 128 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", options.admin_email) or not options.admin_name.strip():
            raise ProvisionError("Optional admin profile requires a valid existing Auth UID, email, and name.")
        path = validate_document_path(f"users/{options.admin_uid}")
        if path in seen:
            raise ProvisionError("The optional admin UID already occurs in the custom structure.")
        documents.append(Document(path, {
            "uid": options.admin_uid, "name": options.admin_name.strip(), "email": options.admin_email,
            "role": "School Admin", "status": "Active", "teacherAssignments": [], "teacherAssignment": None,
            "teacherPrefs": deepcopy(read_json(ASSETS / "user-preferences.json")[0]), "createdAt": deepcopy(SERVER_TIMESTAMP),
        }))
    if len(documents) > MAX_DOCUMENTS:
        raise ProvisionError(f"Including the admin profile, at most {MAX_DOCUMENTS} documents are supported per run.")
    collection_paths = value.get("collectionPaths", [])
    if not isinstance(collection_paths, list) or any(not isinstance(path, str) for path in collection_paths):
        raise ProvisionError("collectionPaths must be an array of informational path strings.")
    return tuple(documents), tuple(collection_paths)


def validate_service_account(path: Path, project: str) -> dict:
    value, _ = read_json(path, 64 * 1024)
    if value.get("type") != "service_account" or any(not isinstance(value.get(key), str) or not value[key] for key in ("project_id", "private_key", "client_email", "token_uri")):
        raise ProvisionError("Choose a Google service-account JSON key, not a Web App config or registration JSON.")
    if value["project_id"] != project:
        raise ProvisionError("The service key belongs to a different project. Choose the key for the selected project.")
    if value["token_uri"] != "https://oauth2.googleapis.com/token" or value.get("universe_domain", "googleapis.com") != "googleapis.com":
        raise ProvisionError("Only standard Google OAuth service-account keys are supported.")
    if "-----BEGIN PRIVATE KEY-----" not in value["private_key"]:
        raise ProvisionError("The service-account private key is missing or malformed.")
    return value


def prepare_plan(options: Options, expected_hash: str = "") -> Plan:
    validate_project(options.project)
    if options.mode not in {"register", "tenant"}:
        raise ProvisionError("Choose Registration or Tenant provision.")
    if options.mode == "register" and options.deploy_indexes:
        raise ProvisionError("Index deployment belongs to Tenant provision.")
    if options.mode == "tenant":
        validate_year(options.school_year)
    value, source_hash = read_json(options.source)
    if expected_hash and source_hash != expected_hash:
        raise ProvisionError("The JSON file changed after review. Review the updated file before running again.")
    if options.service_account:
        validate_service_account(options.service_account, options.project)
    if options.mode == "register":
        documents, paths = (validate_registration(value, options.project),), ()
    else:
        documents, paths = validate_structure(value, options)
    writes = [make_write(options.project, doc.path, doc.data, merge=options.mode == "register") for doc in documents]
    if any(len(json.dumps(write).encode("utf-8")) > 900_000 for write in writes) or len(json.dumps(writes).encode("utf-8")) > 8_000_000:
        raise ProvisionError("Planned document data is too large. Split the custom structure into smaller files.")
    try:
        rules = (ASSETS / ("school-registry.rules" if options.mode == "register" else "firestore.rules")).read_text(encoding="utf-8") if options.deploy_rules else None
        indexes = read_json(ASSETS / "firebase.index.json")[0] if options.deploy_indexes else None
    except OSError as exc:
        raise ProvisionError("Bundled deployment assets are missing. Copy the complete edash_provision folder.") from exc
    return Plan(options, documents, source_hash, rules, indexes, paths)
