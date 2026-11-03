"""Hand a batch to a detached sender so the CLI never waits on the network."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

#: First-party ingest proxy; ``HYPEQUERY_TELEMETRY_URL`` overrides it for staging.
DEFAULT_ENDPOINT = "https://hypequery.com/api/telemetry"
API_KEY = "hypequery-cli"
BATCH_DIRECTORY_PREFIX = "hypequery-telemetry-"
BATCH_FILE = "batch.json"


def telemetry_endpoint(raw: str | None) -> str | None:
    """HTTPS, or HTTP for loopback testing; no credentials, query or fragment."""

    if not raw:
        return None
    try:
        url = urlsplit(raw)
    except ValueError:
        return None
    loopback = url.hostname in ("localhost", "127.0.0.1", "::1")
    if url.scheme != "https" and not (url.scheme == "http" and loopback):
        return None
    if url.username or url.password or url.query or url.fragment or not url.hostname:
        return None
    return raw


def wire_event(event: str, properties: dict[str, Any]) -> dict[str, Any]:
    stamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return {
        "event": event,
        "distinct_id": properties["install_id"],
        "properties": {**properties, "$process_person_profile": False, "$geoip_disable": True},
        "timestamp": stamp,
    }


def dispatch(endpoint: str, events: list[dict[str, Any]]) -> None:
    """Write the batch to a private temporary directory and start the sender."""

    body = json.dumps({"api_key": API_KEY, "batch": events}, separators=(",", ":"))
    directory = Path(tempfile.mkdtemp(prefix=BATCH_DIRECTORY_PREFIX))
    try:
        descriptor = os.open(directory / BATCH_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump({"endpoint": endpoint, "body": body}, handle)
        options: dict[str, Any] = {"start_new_session": True}
        if sys.platform == "win32":
            flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            options = {"creationflags": flags}
        # -P and a private working directory keep the checkout off sys.path, so
        # the sender imports the installed package, never a local `hypequery/`.
        subprocess.Popen(  # noqa: S603 - our own module, fixed argv
            [sys.executable, "-P", "-m", "hypequery.cli.telemetry.sender", str(directory)],
            cwd=directory,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            **options,
        )
    except Exception:
        for child in directory.iterdir():
            child.unlink(missing_ok=True)
        directory.rmdir()
        raise
