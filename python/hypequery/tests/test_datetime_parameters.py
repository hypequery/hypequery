"""Timestamp parameters travel as Unix seconds, never as server-local text."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest

from hypequery.datasets.planner import CompiledQuery, TypedParameter
from hypequery.execution.parameters import bound_parameters
from hypequery.execution.utils.datetime_parameters import unix_seconds


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (datetime(2026, 10, 25, 1, 30, tzinfo=UTC), "1792891800.000000"),
        (datetime(2026, 10, 25, 3, 30, tzinfo=timezone(timedelta(hours=2))), "1792891800.000000"),
        (datetime(1969, 12, 31, 23, 59, 58, 500_000, tzinfo=UTC), "-1.500000"),
        (datetime(1900, 1, 1, tzinfo=UTC), "-2208988800.000000"),
        ("2026-10-25T01:30:00Z", "1792891800.000000"),
        ("2026-10-25T01:30:00.123456Z", "1792891800.123456"),
        ("2026-10-25T03:30:00+02:00", "1792891800.000000"),
    ],
)
def test_instants_become_exact_unix_seconds(value: object, expected: str) -> None:
    assert unix_seconds(value) == expected


@pytest.mark.parametrize(
    "value",
    ["2026-10-25", "2026-10-25 01:30:00", "not a date", datetime(2026, 10, 25, 1, 30), 3, None],
)
def test_values_without_an_offset_pass_through(value: object) -> None:
    assert unix_seconds(value) is value


def _compiled(kind: str, value: object) -> CompiledQuery:
    return CompiledQuery(
        sql="SELECT {p0:" + kind + "} AS value",
        parameters={"p0": TypedParameter("p0", kind, value)},
    )


def test_only_datetime_parameters_are_converted() -> None:
    instant = "2026-10-25T01:30:00Z"
    assert bound_parameters(_compiled("String", instant)) == {"p0": instant}
    assert bound_parameters(_compiled("DateTime64(3)", instant)) == {"p0": "1792891800.000000"}
    assert bound_parameters(_compiled("Array(DateTime64(3))", [instant, "2026-10-25"])) == {
        "p0": ["1792891800.000000", "2026-10-25"]
    }
