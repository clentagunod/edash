"""Resolve public website image paths without depending on this machine's folders."""

import re
from urllib.parse import quote, unquote, urlsplit, urlunsplit


LOGO_REFERENCE_ERROR = (
    "logoUrl must be a website image path (public/assets/school/logo.png, "
    "assets/school/logo.png, or /assets/school/logo.png) or a complete HTTPS image URL. "
    "Website paths must refer to a file included in the website's public folder."
)
VIDEO_REFERENCE_ERROR = (
    "videoUrl must be empty, a website video path (public/assets/school/video.mp4, "
    "assets/school/video.mp4, or /assets/school/video.mp4), or a complete HTTPS video URL."
)


def normalize_asset_reference(value) -> str | None:
    """Mirror shared/asset-reference.mjs while keeping the provisioner standalone."""
    if not isinstance(value, str) or len(value) > 2048:
        return None
    value = value.strip()
    if not value or len(value) > 2048 or re.search(r"[\x00-\x1f\x7f]", value):
        return None
    hosted = bool(re.match(r"https://", value, re.I))
    if hosted:
        if "\\" in value:
            return None
    else:
        if value.startswith("\\") or re.match(r"^[a-z][a-z0-9+.-]*:", value, re.I):
            return None
        value = value.replace("\\", "/")
        if value.startswith("//"):
            return None
        while value.startswith("./"):
            value = value[2:]
        value = value.removeprefix("/")
        if value.startswith("public/"):
            value = value[len("public/"):]
        if not value or value == "public":
            return None
        value = "/" + value
    try:
        parsed = urlsplit(value)
        if not hosted and parsed.netloc:
            return None
        if hosted and (not parsed.hostname or parsed.username is not None or parsed.password is not None):
            return None
        for segment in parsed.path.split("/"):
            if re.search(r"%(?![0-9a-f]{2})", segment, re.I):
                return None
            decoded = unquote(segment, errors="strict")
            if decoded == ".." or re.search(r"[/\\\x00-\x1f\x7f]", decoded):
                return None
        # URL parsing removes dot segments, but preserves repeated path separators.
        parts = parsed.path.split("/")
        path = "/".join(segment for index, segment in enumerate(parts)
                         if unquote(segment) != "." or index == len(parts) - 1)
        if parts and unquote(parts[-1]) == ".":
            path = path.rsplit("/", 1)[0] + "/"
        path = path or "/"
        if not path.startswith("/"):
            path = "/" + path
        if not hosted and path == "/":
            return None
        path = quote(path, safe="/:@-._~!$&'()*+,;=%[]")
        query = quote(parsed.query, safe="/?:@-._~!$&()*+,;=%[]^|`{}")
        fragment = quote(parsed.fragment, safe="/?:@-._~!$&'()*+,;=%[]^|{}")
        host = ""
        if hosted:
            hostname = parsed.hostname.encode("idna").decode("ascii").lower()
            if re.search(r"\s", hostname):
                return None
            host = f"[{hostname}]" if ":" in hostname else hostname
            port = parsed.port
            if port is not None and port != 443:
                host += f":{port}"
        return urlunsplit(("https" if hosted else "", host, path, query, fragment))
    except (ValueError, UnicodeError):
        return None
