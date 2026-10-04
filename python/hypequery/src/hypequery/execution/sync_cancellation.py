"""Monitor blocking driver work on a separate cancellation control connection."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable

from hypequery.datasets.planner import CompiledQuery

from .cancellation import terminal_error

_LOGGER = logging.getLogger(__name__)


class SyncCancellationMonitor:
    def __init__(self, compiled: CompiledQuery, cancel: Callable[[str], object]) -> None:
        self._compiled = compiled
        self._cancel = cancel
        self._done = threading.Event()
        self._thread = threading.Thread(target=self._watch, daemon=True)

    def _watch(self) -> None:
        while not self._done.wait(0.025):
            if terminal_error(self._compiled) is not None:
                try:
                    self._cancel(self._compiled.query_id)
                except Exception:
                    # Preserve cancellation precedence even if the control request fails.
                    _LOGGER.warning(
                        "Server cancellation failed for query %s", self._compiled.query_id
                    )
                return

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._done.set()
