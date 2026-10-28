"""Recognise a KILL QUERY that ClickHouse refused, and say so once.

Asking again cannot succeed until an operator changes grants, so retries stop
and the query runs on to ``max_execution_time``. That is worth one loud log
line per process, not one per retry.
"""

from __future__ import annotations

import logging
import threading

from hypequery.datasets.planner import CompiledQueryError

_LOGGER = logging.getLogger("hypequery.execution.cancellation")
_LOCK = threading.Lock()
_reported = False


def is_refused_kill(exc: Exception) -> bool:
    """True when the control connection lacks the privilege to cancel."""

    return isinstance(exc, CompiledQueryError) and exc.code == "HQ_EXECUTOR_ACCESS_DENIED"


def report_refused_kill() -> None:
    global _reported
    with _LOCK:
        if _reported:
            return
        _reported = True
    _LOGGER.error(
        "ClickHouse refused KILL QUERY, so cancelled and timed-out queries keep running "
        "until max_execution_time. Grant the query user SELECT ON system.processes, or set "
        "control_username (CLICKHOUSE_CONTROL_USERNAME) to a user with SELECT ON "
        "system.processes and KILL QUERY."
    )
