"""Bounded, duplicate-refusing JSON decoding for backend results."""

from __future__ import annotations

import json

MAX_RESULT_JSON_BYTES = 1_048_576
MAX_NODES = 10_000
MAX_DEPTH = 16
MAX_MEMBERS = 1000


class ResultJsonBudgetError(ValueError):
    """The result is valid JSON but larger than the validator will walk."""


def _pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    if len(pairs) > MAX_MEMBERS:
        raise ResultJsonBudgetError("HTTP result JSON exceeds validation limits.")
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON member")
        result[key] = value
    return result


def _reject_constant(name: str) -> object:
    raise ValueError(f"Invalid JSON number {name}")


def _check(value: object, depth: int, budget: list[int]) -> None:
    budget[0] += 1
    if budget[0] > MAX_NODES or depth > MAX_DEPTH:
        raise ResultJsonBudgetError("HTTP result JSON exceeds validation limits.")
    if isinstance(value, dict):
        for item in value.values():
            _check(item, depth + 1, budget)
    elif isinstance(value, list):
        if len(value) > MAX_MEMBERS:
            raise ResultJsonBudgetError("HTTP result JSON exceeds validation limits.")
        for item in value:
            _check(item, depth + 1, budget)


def decode_result_json(text: str) -> object:
    """Parse *text*, refusing duplicate members, NaN/Infinity and oversized documents."""

    if len(text.encode("utf-8")) > MAX_RESULT_JSON_BYTES:
        raise ResultJsonBudgetError("HTTP result JSON exceeds validation limits.")
    try:
        value: object = json.loads(text, object_pairs_hook=_pairs, parse_constant=_reject_constant)
    except RecursionError:
        raise ResultJsonBudgetError("HTTP result JSON exceeds validation limits.") from None
    _check(value, 0, [0])
    return value
