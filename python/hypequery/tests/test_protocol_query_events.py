"""RFC 0011 query events and diagnostics against the shared fixture corpus.

Mirrors `packages/protocol/src/events/events.test.ts`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.protocol import (
    ProtocolQueryDiagnosticsError,
    ProtocolQueryEventError,
    ProtocolQueryEventLimits,
    validate_protocol_query_diagnostics,
    validate_protocol_query_event,
)
from hypequery.protocol.query_event_fixtures import (
    materialize_diagnostics_fixture,
    materialize_event_fixture,
)

FIXTURES = Path(__file__).resolve().parents[3] / "specs" / "security-protocol" / "fixtures"

EVENT_FAILURE_CODES = {
    "HQ_EVENT_TYPE",
    "HQ_EVENT_UNKNOWN_FIELD",
    "HQ_EVENT_INVALID_VERSION",
    "HQ_EVENT_INVALID_VALUE",
    "HQ_EVENT_TOO_LARGE",
    "HQ_EVENT_UNSAFE_OBJECT",
}
DIAGNOSTICS_FAILURE_CODES = {
    "HQ_DIAGNOSTICS_TYPE",
    "HQ_DIAGNOSTICS_UNKNOWN_FIELD",
    "HQ_DIAGNOSTICS_INVALID_VERSION",
    "HQ_DIAGNOSTICS_INVALID_VALUE",
    "HQ_DIAGNOSTICS_TOO_LARGE",
    "HQ_DIAGNOSTICS_UNSAFE_OBJECT",
}


def _fixtures(family: str, name: str) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], json.loads((FIXTURES / family / name).read_text()))


def _generator(fixture: dict[str, object]) -> dict[str, object]:
    return cast(dict[str, object], fixture["generator"])


def _event(**overrides: object) -> dict[str, object]:
    return {
        **cast(dict[str, object], materialize_event_fixture({"type": "newer-version"})),
        "version": 1,
        **overrides,
    }


def _diagnostics(**overrides: object) -> dict[str, object]:
    base = cast(dict[str, object], materialize_diagnostics_fixture({"type": "newer-version"}))
    return {**base, "version": 1, **overrides}


EVENT_SUCCESS = _fixtures("query-events-v1", "success.json")
EVENT_REJECTIONS = _fixtures("query-events-v1", "rejections.json")
DIAGNOSTICS_SUCCESS = _fixtures("query-diagnostics-v1", "success.json")
DIAGNOSTICS_REJECTIONS = _fixtures("query-diagnostics-v1", "rejections.json")


def _ids(fixtures: list[dict[str, object]]) -> list[str]:
    return [str(fixture["id"]) for fixture in fixtures]


# --- query event v1 ---


def test_event_fixtures_are_unique_and_cover_every_code() -> None:
    fixtures = EVENT_SUCCESS + EVENT_REJECTIONS
    assert len(set(_ids(fixtures))) == len(fixtures)
    assert {fixture["error"] for fixture in EVENT_REJECTIONS} == EVENT_FAILURE_CODES


@pytest.mark.parametrize("fixture", EVENT_SUCCESS, ids=_ids(EVENT_SUCCESS))
def test_event_accepts(fixture: dict[str, object]) -> None:
    assert validate_protocol_query_event(fixture["value"]) == fixture["value"]


@pytest.mark.parametrize("fixture", EVENT_REJECTIONS, ids=_ids(EVENT_REJECTIONS))
def test_event_rejects_with_stable_code(fixture: dict[str, object]) -> None:
    with pytest.raises(ProtocolQueryEventError) as caught:
        validate_protocol_query_event(materialize_event_fixture(_generator(fixture)))
    assert caught.value.code == fixture["error"]


def test_event_unknown_version_is_skippable() -> None:
    with pytest.raises(ProtocolQueryEventError) as caught:
        validate_protocol_query_event(materialize_event_fixture({"type": "newer-version"}))
    assert caught.value.code == "HQ_EVENT_INVALID_VERSION"


def test_event_rejects_raised_limits() -> None:
    with pytest.raises(ValueError, match="query event v1 maximum"):
        ProtocolQueryEventLimits(max_string_bytes=1_025)


def test_event_honors_tightened_limits() -> None:
    with pytest.raises(ProtocolQueryEventError) as caught:
        validate_protocol_query_event(
            _event(correlationId="x" * 17),
            limits=ProtocolQueryEventLimits(max_string_bytes=16),
        )
    assert caught.value.code == "HQ_EVENT_TOO_LARGE"


def test_event_rejects_control_characters_in_free_text() -> None:
    with pytest.raises(ProtocolQueryEventError) as caught:
        validate_protocol_query_event(_event(correlationId="bad\u0007id"))
    assert caught.value.code == "HQ_EVENT_INVALID_VALUE"


def test_event_reports_first_failure_in_rfc_order() -> None:
    with pytest.raises(ProtocolQueryEventError) as caught:
        validate_protocol_query_event(_event(eventId="bad", durationMs=-1, extra=True))
    assert (caught.value.code, caught.value.path) == ("HQ_EVENT_UNKNOWN_FIELD", "$.extra")
    with pytest.raises(ProtocolQueryEventError) as caught:
        validate_protocol_query_event(_event(eventId="bad", durationMs=-1))
    assert (caught.value.code, caught.value.path) == ("HQ_EVENT_INVALID_VALUE", "$.eventId")
    with pytest.raises(ProtocolQueryEventError) as caught:
        validate_protocol_query_event(_event(outcome="failure", durationMs=-1))
    assert caught.value.path == "$.errorCategory"


def test_event_accepts_leap_days_and_rejects_impossible_dates() -> None:
    validate_protocol_query_event(_event(occurredAt="2028-02-29T23:59:59Z"))
    for occurred_at in ("2027-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-07-20T12:60:00Z"):
        with pytest.raises(ProtocolQueryEventError) as caught:
            validate_protocol_query_event(_event(occurredAt=occurred_at))
        assert caught.value.code == "HQ_EVENT_INVALID_VALUE"


def test_event_compares_integers_by_value() -> None:
    # The conformance runner hands Python every JSON number as a float.
    event = validate_protocol_query_event(_event(version=1.0, durationMs=182.0))
    assert event["durationMs"] == 182
    assert type(event["durationMs"]) is int


# --- query diagnostics v1 ---


def test_diagnostics_fixtures_are_unique_and_cover_every_code() -> None:
    fixtures = DIAGNOSTICS_SUCCESS + DIAGNOSTICS_REJECTIONS
    assert len(set(_ids(fixtures))) == len(fixtures)
    assert {fixture["error"] for fixture in DIAGNOSTICS_REJECTIONS} == DIAGNOSTICS_FAILURE_CODES


@pytest.mark.parametrize("fixture", DIAGNOSTICS_SUCCESS, ids=_ids(DIAGNOSTICS_SUCCESS))
def test_diagnostics_accepts(fixture: dict[str, object]) -> None:
    assert validate_protocol_query_diagnostics(fixture["value"]) == fixture["value"]


@pytest.mark.parametrize("fixture", DIAGNOSTICS_REJECTIONS, ids=_ids(DIAGNOSTICS_REJECTIONS))
def test_diagnostics_rejects_with_stable_code(fixture: dict[str, object]) -> None:
    with pytest.raises(ProtocolQueryDiagnosticsError) as caught:
        validate_protocol_query_diagnostics(materialize_diagnostics_fixture(_generator(fixture)))
    assert caught.value.code == fixture["error"]


def test_diagnostics_unknown_version_is_skippable() -> None:
    with pytest.raises(ProtocolQueryDiagnosticsError) as caught:
        validate_protocol_query_diagnostics(
            materialize_diagnostics_fixture({"type": "newer-version"})
        )
    assert caught.value.code == "HQ_DIAGNOSTICS_INVALID_VERSION"


def test_diagnostics_rejects_raised_limits() -> None:
    with pytest.raises(ValueError, match="query event v1 maximum"):
        ProtocolQueryEventLimits(max_debug_bytes=4_097)


def test_diagnostics_honors_tightened_limits() -> None:
    with pytest.raises(ProtocolQueryDiagnosticsError) as caught:
        validate_protocol_query_diagnostics(
            _diagnostics(debugQuery="x" * 11),
            limits=ProtocolQueryEventLimits(max_debug_bytes=10),
        )
    assert caught.value.code == "HQ_DIAGNOSTICS_TOO_LARGE"
