"""Entry point of the detached sender; the CLI itself never imports this module.

One bounded POST with no retries. A 410 from the proxy disables this package
version on the installation (the kill switch). Every failure is dropped.
"""

from __future__ import annotations

import contextlib
import json
import shutil
import sys
import urllib.error
import urllib.request
from importlib.metadata import version
from pathlib import Path

from .settings import SettingsStore
from .transport import BATCH_DIRECTORY_PREFIX, BATCH_FILE, telemetry_endpoint

DELIVERY_TIMEOUT_SECONDS = 5.0


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


def send(directory: str | None) -> None:
    if not directory or not Path(directory).name.startswith(BATCH_DIRECTORY_PREFIX):
        return
    try:
        batch = json.loads((Path(directory) / BATCH_FILE).read_text(encoding="utf-8"))
    finally:
        shutil.rmtree(directory, ignore_errors=True)
    endpoint = telemetry_endpoint(batch.get("endpoint")) if isinstance(batch, dict) else None
    body = batch.get("body") if isinstance(batch, dict) else None
    if endpoint is None or not isinstance(body, str):
        return
    request = urllib.request.Request(  # noqa: S310 - scheme checked by telemetry_endpoint
        endpoint, data=body.encode(), method="POST", headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.build_opener(_NoRedirect).open(
            request, timeout=DELIVERY_TIMEOUT_SECONDS
        ) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
    settings = batch.get("settings")
    if status == 410 and isinstance(settings, str) and Path(settings).is_absolute():
        SettingsStore({"HYPEQUERY_CONFIG_DIR": settings}).disable_version(version("hypequery"))


if __name__ == "__main__":
    with contextlib.suppress(Exception):  # Delivery is best-effort.
        send(sys.argv[1] if len(sys.argv) > 1 else None)
