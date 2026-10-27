"""Firestore REST value encoding, merge masks, and server timestamps."""

import math
import re
from typing import Any

from .models import ProvisionError

SERVER_TIMESTAMP = {"$serverTimestamp": True}


def field_path(parts: tuple[str, ...]) -> str:
    return ".".join(part if re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", part)
                    else "`" + part.replace("\\", "\\\\").replace("`", "\\`") + "`" for part in parts)


def validate_key(key: str) -> None:
    if not key or len(key.encode("utf-8")) > 1500 or re.fullmatch(r"__.*__", key):
        raise ProvisionError("Firestore field names must be nonempty, at most 1,500 bytes, and not reserved (__…__).")


def encode_value(value: Any, depth: int = 0, array_item: bool = False) -> dict:
    if depth > 20:
        raise ProvisionError("Firestore data exceeds the supported 20 nesting levels.")
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        if not -(2**63) <= value < 2**63:
            raise ProvisionError("An integer exceeds Firestore's signed 64-bit range.")
        return {"integerValue": str(value)}
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ProvisionError("NaN and infinite numbers are not supported.")
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        if array_item:
            raise ProvisionError("Firestore arrays cannot directly contain other arrays.")
        return {"arrayValue": {"values": [encode_value(item, depth + 1, True) for item in value]}}
    if isinstance(value, dict):
        if "$serverTimestamp" in value:
            raise ProvisionError("Server timestamp markers must be document/map fields, not array values.")
        fields = {}
        for key, item in value.items():
            validate_key(key)
            fields[key] = encode_value(item, depth + 1)
        return {"mapValue": {"fields": fields}}
    raise ProvisionError("Only JSON objects, arrays, strings, booleans, finite numbers, and null are supported.")


def encode_document(data: dict, *, merge: bool = False) -> tuple[dict, list[str], list[dict]]:
    mask: list[str] = []
    transforms: list[dict] = []

    def walk(values: dict, prefix: tuple[str, ...], depth: int) -> dict:
        if depth > 20:
            raise ProvisionError("Firestore data exceeds the supported 20 nesting levels.")
        fields = {}
        for key, value in values.items():
            validate_key(key)
            path = prefix + (key,)
            if isinstance(value, dict) and "$serverTimestamp" in value:
                if set(value) != {"$serverTimestamp"} or value["$serverTimestamp"] is not True:
                    raise ProvisionError('A timestamp marker must be exactly {"$serverTimestamp": true}.')
                transforms.append({"fieldPath": field_path(path), "setToServerValue": "REQUEST_TIME"})
            elif isinstance(value, dict) and value:
                nested = walk(value, path, depth + 1)
                if nested:
                    fields[key] = {"mapValue": {"fields": nested}}
            else:
                fields[key] = encode_value(value, depth + 1)
                # Recursive registration upserts preserve omitted children of an
                # empty map, matching the website's registration script.
                if not (merge and value == {}):
                    mask.append(field_path(path))
        return fields

    fields = walk(data, (), 0)
    if len(transforms) > 500:
        raise ProvisionError("A document may contain at most 500 server timestamp transforms per commit.")
    return fields, mask, transforms


def make_write(project: str, path: str, data: dict, *, merge: bool = False) -> dict:
    fields, mask, transforms = encode_document(data, merge=merge)
    write: dict = {"update": {"name": f"projects/{project}/databases/(default)/documents/{path}", "fields": fields}}
    if merge:
        write["updateMask"] = {"fieldPaths": mask}
    else:
        write["currentDocument"] = {"exists": False}
    if transforms:
        write["updateTransforms"] = transforms
    return write
