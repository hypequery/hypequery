"""Say once when an adapter is served below a prefix its client contract omits.

The prefix a server or framework mount reports (ASGI ``root_path``, WSGI
``SCRIPT_NAME``) never names contract or OpenAPI paths: a proxy can set it.
Those use the API's ``client_mount_path``, trusted configuration. When the two
differ, generated clients call paths the app does not serve, so the first such
request logs how to configure it.
"""

from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..core.api import Api

_log = logging.getLogger("hypequery.serve")
#: Enough to recognise a prefix; a longer one is not repeated into logs.
_SHOWN = 200


class UnconfiguredMount:
    """Per adapter: warns on the first request below an unconfigured prefix."""

    __slots__ = ("_lock", "_reported")

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._reported = threading.Event()

    def check(self, api: Api, prefix: str) -> None:
        prefix = prefix.rstrip("/")
        if self._reported.is_set() or not prefix or prefix == api.client_mount_path:
            return
        with self._lock:
            if self._reported.is_set():
                return
            self._reported.set()
        shown = prefix[:_SHOWN]
        _log.warning(
            "This API is served below %r, but its client contract and OpenAPI document "
            "name paths under %r, so generated clients call paths it does not serve. If "
            "clients reach it at that prefix, pass create_api(client_mount_path=%r).",
            shown,
            api.client_mount_path or "/",
            shown,
        )
