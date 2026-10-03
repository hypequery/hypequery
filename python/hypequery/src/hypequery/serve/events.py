"""Metadata-only execution events, validated before reaching the host sink."""

from __future__ import annotations

import logging
import secrets
from collections.abc import Callable, Mapping
from datetime import UTC, datetime

from ..datasets.planner import CompiledQueryError
from ..protocol.query_events import validate_protocol_query_event
from ..protocol.releases import validate_protocol_deployment_release_target

EventSink = Callable[[dict[str, object]], None]


class QueryEvents:
    def __init__(self, *, target: Mapping[str, object], sink: EventSink) -> None:
        self._target = validate_protocol_deployment_release_target(dict(target))
        if not callable(sink):
            raise TypeError("event sink must be callable")
        self._sink = sink

    def emit(
        self,
        name: str,
        duration_ms: float,
        *,
        row_count: int | None = None,
        error: BaseException | None = None,
    ) -> None:
        event: dict[str, object] = {
            "kind": "hypequery-query-event",
            "version": 1,
            "eventId": secrets.token_hex(32),
            "occurredAt": datetime.now(UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "target": self._target,
            "queryName": name,
            "operation": "query",
            "outcome": "success" if error is None else "failure",
            "durationMs": min(86_400_000, max(0, round(duration_ms))),
        }
        if row_count is not None:
            event["rowCount"] = row_count
        if error is not None:
            event["errorCategory"] = (
                error.category if isinstance(error, CompiledQueryError) else "internal"
            )
        try:
            self._sink(validate_protocol_query_event(event))
        except Exception:
            # Telemetry is optional and never exposes the sink's exception.
            logging.getLogger("hypequery.serve").warning("Query event sink failed")
