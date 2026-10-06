"""Monitor blocking driver work on a separate cancellation control connection."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable

from hypequery.datasets.planner import CompiledQuery

from .cancellation import terminal_error

_LOGGER = logging.getLogger(__name__)


def server_cancellation_confirmed(response: object) -> bool:
    """KILL ... SYNC returns a finished status only when it matched a query."""
    if isinstance(response, str):
        return response.split("\t", 1)[0] == "finished"
    if isinstance(response, (list, tuple)) and response:
        status: object = response[0]
        return isinstance(status, str) and status == "finished"
    return False


class SyncCancellationMonitor:
    def __init__(self, compiled: CompiledQuery, cancel: Callable[[str], object]) -> None:
        self._compiled = compiled
        self._cancel = cancel
        self._done = threading.Event()
        self._thread = threading.Thread(target=self._watch, daemon=True)

    def _watch(self) -> None:
        interval = 0.025
        warned = False
        while not self._done.wait(interval):
            if terminal_error(self._compiled) is not None:
                try:
                    if server_cancellation_confirmed(self._cancel(self._compiled.query_id)):
                        return
                except Exception:
                    # Preserve cancellation precedence even if the control request fails.
                    if not warned:
                        _LOGGER.warning(
                            "Server cancellation failed for query %s", self._compiled.query_id
                        )
                        warned = True
                # The driver may still be submitting the query when the first
                # KILL runs. Retry until the driver finishes so a query that
                # registers after cancellation cannot escape the control path.
                interval = min(interval * 2, 1.0)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._done.set()
