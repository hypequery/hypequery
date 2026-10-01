"""Materializers for the `query-events-v1` and `query-diagnostics-v1` fixtures.

Each case mirrors the TypeScript reference generator of the same name in
`packages/protocol-conformance/src/adapters/generators.ts`, so both languages
validate the same records.
"""

from __future__ import annotations

from .fixture_primitives import UnsafeAccessor


def _event() -> dict[str, object]:
    return {
        "kind": "hypequery-query-event",
        "version": 1,
        "eventId": "0" * 64,
        "occurredAt": "2026-07-20T12:34:56.789Z",
        "target": {"project": "project_1", "environment": "production"},
        "queryName": "daily_revenue",
        "operation": "query",
        "outcome": "success",
        "durationMs": 182,
    }


def materialize_event_fixture(generator: dict[str, object]) -> object:
    """Materialize one generator from the query-events-v1 fixtures."""

    kind = generator.get("type")
    value = _event()
    if kind == "wrong-root-type":
        return []
    if kind == "missing-required-field":
        del value["durationMs"]
        return value
    cases: dict[str, dict[str, object]] = {
        "unknown-sql-field": {"sql": "SELECT 1"},
        "unknown-parameters-field": {"parameters": {"start": "2026-01-01"}},
        "unknown-raw-tenant-field": {"tenantId": "acme"},
        "newer-version": {"version": 2},
        "malformed-event-id": {"eventId": "bad"},
        "invalid-occurred-at": {"occurredAt": "2026-13-40T99:99:99Z"},
        "failure-without-category": {"outcome": "failure"},
        "success-with-category": {"errorCategory": "internal"},
        "unknown-error-category": {"outcome": "failure", "errorCategory": "exploded"},
        "negative-duration": {"durationMs": -1},
        "invalid-target": {"target": {"project": "has space", "environment": "production"}},
        "invalid-query-name": {"queryName": "not an identifier"},
        "oversized-correlation-id": {"correlationId": "x" * 2_049},
        "newer-version-with-new-field": {"version": 2, "sampleRate": 0.5},
        "wrong-kind-with-unknown-field": {"kind": "hypequery-query-log", "sql": "SELECT 1"},
        "impossible-calendar-date": {"occurredAt": "2026-02-30T00:00:00Z"},
        "hour-twenty-four": {"occurredAt": "2026-07-20T24:00:00Z"},
        "one-digit-fraction": {"occurredAt": "2026-07-20T12:34:56.5Z"},
        "fractional-duration": {"durationMs": 1.5},
        "correlation-id-one-byte-over": {"correlationId": "é" * 512 + "x"},
        "correlation-id-lone-surrogate": {"correlationId": "req\ud800id"},
    }
    if kind == "unsafe-accessor":
        return UnsafeAccessor()
    if type(kind) is str and kind in cases:
        return {**value, **cases[kind]}
    raise RuntimeError(f"unknown event generator: {kind!r}")


def _diagnostics() -> dict[str, object]:
    return {
        "kind": "hypequery-query-diagnostics",
        "version": 1,
        "eventId": "0" * 64,
        "queryId": "1" * 64,
        "terminalReason": "completed",
        "attempts": 1,
    }


def materialize_diagnostics_fixture(generator: dict[str, object]) -> object:
    """Materialize one generator from the query-diagnostics-v1 fixtures."""

    kind = generator.get("type")
    value = _diagnostics()
    if kind == "wrong-root-type":
        return []
    if kind == "missing-required-field":
        del value["attempts"]
        return value
    cases: dict[str, dict[str, object]] = {
        "unknown-result-field": {"rows": [[1, 2]]},
        "unknown-credentials-field": {"password": "hunter2"},
        "newer-version": {"version": 2},
        "malformed-query-id": {"queryId": "bad"},
        "unknown-terminal-reason": {"terminalReason": "exploded"},
        "zero-attempts": {"attempts": 0},
        "control-character-message": {"safeMessage": "bad\u0007message"},
        "oversized-debug-query": {"debugQuery": "x" * 4_097},
        "newer-version-with-new-field": {"version": 2, "retryReason": "transient"},
        "too-many-attempts": {"attempts": 65},
        "prefixed-runtime-identity": {"runtimeIdentity": "sha256:" + "d" * 64},
        "debug-query-lone-surrogate": {"debugQuery": "SELECT \udc00"},
        "debug-query-bell-character": {"debugQuery": "SELECT\u00071"},
    }
    if kind == "unsafe-accessor":
        return UnsafeAccessor()
    if type(kind) is str and kind in cases:
        return {**value, **cases[kind]}
    raise RuntimeError(f"unknown diagnostics generator: {kind!r}")
