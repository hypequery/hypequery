"""Strict RFC 0011 query event and query diagnostics validation.

Both records are metadata-only and closed: an exact field set, fixed formats,
and size caps. Neither has a field that can hold rows, parameter values, SQL
text, raw tenant identifiers, or credentials. Checks run in the RFC's
validation order so a record that breaks several rules reports the same code
here as in the TypeScript reference.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass, fields
from typing import NoReturn, cast

from .errors import (
    ProtocolDeploymentReleaseError,
    ProtocolIdentifierError,
    diagnostics_error,
    event_error,
)
from .identifiers import parse_protocol_qualified_identifier
from .releases import validate_protocol_deployment_release_target
from .utf8 import exceeds_utf8_byte_limit

_HEX64 = re.compile(r"[0-9a-f]{64}\Z", re.ASCII)
_OCCURRED_AT = re.compile(
    r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{3})?Z\Z",
    re.ASCII,
)
_OPERATIONS = ("query", "command", "insert")
_OUTCOMES = ("success", "failure")
_ERROR_CATEGORIES = (
    "input-invalid",
    "unauthenticated",
    "forbidden",
    "tenant-required",
    "not-found",
    "too-large",
    "aborted",
    "deadline-exceeded",
    "unavailable",
    "internal",
)
_TERMINAL_REASONS = ("completed", "aborted", "deadline-exceeded", "drained")
_MAX_DURATION_MS = 86_400_000
_MAX_ROW_COUNT = 1_000_000_000_000
_MAX_ATTEMPTS = 64
# The compiler's debug form spans lines, so debugQuery alone may carry tab,
# line feed, and carriage return.
_LINE_BREAKS = frozenset((0x09, 0x0A, 0x0D))
_EVENT_LIMIT_MAXIMUMS = {"max_string_bytes": 1_024, "max_debug_bytes": 4_096}


@dataclass(frozen=True, slots=True)
class ProtocolQueryEventLimits:
    """Product limits that may lower, but never raise, query event v1 limits."""

    max_string_bytes: int = _EVENT_LIMIT_MAXIMUMS["max_string_bytes"]
    max_debug_bytes: int = _EVENT_LIMIT_MAXIMUMS["max_debug_bytes"]

    def __post_init__(self) -> None:
        for limit in fields(self):
            value = getattr(self, limit.name)
            maximum = _EVENT_LIMIT_MAXIMUMS[limit.name]
            if type(value) is not int or value < 1 or value > maximum:
                msg = (
                    f"{limit.name} must be a positive integer no greater than "
                    f"{maximum} (the query event v1 maximum)"
                )
                raise ValueError(msg)


DEFAULT_PROTOCOL_QUERY_EVENT_LIMITS = ProtocolQueryEventLimits()


@dataclass(frozen=True, slots=True)
class _Context:
    """The error family one record reports with."""

    prefix: str
    fail: Callable[[str, str], NoReturn]

    def error(self, suffix: str, path: str = "$") -> NoReturn:
        self.fail(f"{self.prefix}_{suffix}", path)


_EVENT = _Context("HQ_EVENT", cast(Callable[[str, str], NoReturn], event_error))
_DIAGNOSTICS = _Context("HQ_DIAGNOSTICS", cast(Callable[[str, str], NoReturn], diagnostics_error))


def _record(context: _Context, value: object, path: str) -> dict[str, object]:
    if type(value) is dict:
        for key in value:
            if type(key) is not str:
                context.error("UNSAFE_OBJECT", path)
        return cast(dict[str, object], value)
    if value is None or type(value) in (bool, str, int, float, list):
        context.error("TYPE", path)
    context.error("UNSAFE_OBJECT", path)


def _kind_and_version(context: _Context, value: dict[str, object], kind: str) -> None:
    # Types are checked before equality so no foreign __eq__ ever runs.
    actual = value.get("kind")
    if type(actual) is not str:
        context.error("TYPE", "$.kind")
    if actual != kind:
        context.error("INVALID_VALUE", "$.kind")
    version = value.get("version")
    if type(version) is bool or type(version) not in (int, float):
        context.error("TYPE", "$.version")
    if version != 1:
        context.error("INVALID_VERSION", "$.version")


def _exact_fields(
    context: _Context,
    value: dict[str, object],
    required: tuple[str, ...],
    optional: tuple[str, ...],
) -> None:
    allowed = frozenset(required + optional)
    for key in value:
        if key not in allowed:
            context.error("UNKNOWN_FIELD", f"$.{key}")
    for key in required:
        if key not in value:
            context.error("TYPE", f"$.{key}")


def _string(context: _Context, value: object, path: str) -> str:
    if type(value) is not str:
        context.error("TYPE", path)
    return value


def _has_forbidden_code_unit(text: str, allow_line_breaks: bool) -> bool:
    """C0 controls, DEL, the C1 range, and unpaired surrogates.

    A high and low surrogate held as two code points form one valid pair,
    as they do in a JavaScript string.
    """

    index = 0
    while index < len(text):
        code = ord(text[index])
        if code <= 0x1F and allow_line_breaks and code in _LINE_BREAKS:
            index += 1
            continue
        if code <= 0x1F or 0x7F <= code <= 0x9F:
            return True
        if 0xD800 <= code <= 0xDBFF:
            if not (index + 1 < len(text) and 0xDC00 <= ord(text[index + 1]) <= 0xDFFF):
                return True
            index += 1
        elif 0xDC00 <= code <= 0xDFFF:
            return True
        index += 1
    return False


def _bounded_text(
    context: _Context,
    value: object,
    path: str,
    maximum: int,
    allow_line_breaks: bool = False,
) -> str:
    text = _string(context, value, path)
    if len(text) > maximum or exceeds_utf8_byte_limit(text, maximum):
        context.error("TOO_LARGE", path)
    if _has_forbidden_code_unit(text, allow_line_breaks):
        context.error("INVALID_VALUE", path)
    return text


def _hex_identity(context: _Context, value: object, path: str) -> str:
    text = _string(context, value, path)
    if _HEX64.match(text) is None:
        context.error("INVALID_VALUE", path)
    return text


def _days_in_month(year: int, month: int) -> int:
    # Proleptic Gregorian, matching JavaScript Date; year 0000 is a leap year.
    if month == 2:
        leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
        return 29 if leap else 28
    return 30 if month in (4, 6, 9, 11) else 31


def _occurred_at(context: _Context, value: object, path: str) -> str:
    text = _string(context, value, path)
    match = _OCCURRED_AT.match(text)
    if match is None:
        context.error("INVALID_VALUE", path)
    year, month, day, hour, minute, second = (int(part) for part in match.groups())
    if not (
        1 <= month <= 12
        and 1 <= day <= _days_in_month(year, month)
        and hour <= 23
        and minute <= 59
        and second <= 59
    ):
        context.error("INVALID_VALUE", path)
    return text


def _bounded_count(
    context: _Context,
    value: object,
    path: str,
    minimum: int,
    maximum: int,
) -> int:
    """An integer compared by value: ``1`` and ``1.0`` are both accepted."""

    if type(value) is bool or type(value) not in (int, float):
        context.error("TYPE", path)
    number = cast("int | float", value)
    if type(number) is float and not (math.isfinite(number) and number.is_integer()):
        context.error("INVALID_VALUE", path)
    if number < minimum or number > maximum:
        context.error("INVALID_VALUE", path)
    return int(number)


def _choice(context: _Context, value: object, path: str, choices: tuple[str, ...]) -> str:
    text = _string(context, value, path)
    if text not in choices:
        context.error("INVALID_VALUE", path)
    return text


def _target(context: _Context, value: object, path: str) -> dict[str, object]:
    try:
        return validate_protocol_deployment_release_target(value)
    except ProtocolDeploymentReleaseError:
        context.error("INVALID_VALUE", path)


def _query_name(context: _Context, value: object, path: str) -> str:
    text = _string(context, value, path)
    try:
        parse_protocol_qualified_identifier(text)
    except ProtocolIdentifierError:
        context.error("INVALID_VALUE", path)
    return text


def validate_protocol_query_event(
    value: object,
    *,
    limits: ProtocolQueryEventLimits = DEFAULT_PROTOCOL_QUERY_EVENT_LIMITS,
) -> dict[str, object]:
    """Validate an RFC 0011 query event and return it as detached protocol data."""

    context = _EVENT
    node = _record(context, value, "$")
    _kind_and_version(context, node, "hypequery-query-event")
    _exact_fields(
        context,
        node,
        (
            "kind",
            "version",
            "eventId",
            "occurredAt",
            "target",
            "queryName",
            "operation",
            "outcome",
            "durationMs",
        ),
        ("errorCategory", "rowCount", "tenantFingerprint", "correlationId"),
    )
    event: dict[str, object] = {
        "kind": "hypequery-query-event",
        "version": 1,
        "eventId": _hex_identity(context, node["eventId"], "$.eventId"),
        "occurredAt": _occurred_at(context, node["occurredAt"], "$.occurredAt"),
        "target": _target(context, node["target"], "$.target"),
        "queryName": _query_name(context, node["queryName"], "$.queryName"),
        "operation": _choice(context, node["operation"], "$.operation", _OPERATIONS),
    }
    outcome = _choice(context, node["outcome"], "$.outcome", _OUTCOMES)
    has_category = "errorCategory" in node
    if (outcome == "failure") != has_category:
        context.error("INVALID_VALUE", "$.errorCategory")
    event["outcome"] = outcome
    if has_category:
        event["errorCategory"] = _choice(
            context, node["errorCategory"], "$.errorCategory", _ERROR_CATEGORIES
        )
    event["durationMs"] = _bounded_count(
        context, node["durationMs"], "$.durationMs", 0, _MAX_DURATION_MS
    )
    if "rowCount" in node:
        event["rowCount"] = _bounded_count(
            context, node["rowCount"], "$.rowCount", 0, _MAX_ROW_COUNT
        )
    if "tenantFingerprint" in node:
        event["tenantFingerprint"] = _hex_identity(
            context, node["tenantFingerprint"], "$.tenantFingerprint"
        )
    if "correlationId" in node:
        event["correlationId"] = _bounded_text(
            context, node["correlationId"], "$.correlationId", limits.max_string_bytes
        )
    return event


def validate_protocol_query_diagnostics(
    value: object,
    *,
    limits: ProtocolQueryEventLimits = DEFAULT_PROTOCOL_QUERY_EVENT_LIMITS,
) -> dict[str, object]:
    """Validate an RFC 0011 diagnostics projection and return it as detached data."""

    context = _DIAGNOSTICS
    node = _record(context, value, "$")
    _kind_and_version(context, node, "hypequery-query-diagnostics")
    _exact_fields(
        context,
        node,
        ("kind", "version", "eventId", "queryId", "terminalReason", "attempts"),
        ("runtimeIdentity", "debugQuery", "safeMessage"),
    )
    diagnostics: dict[str, object] = {
        "kind": "hypequery-query-diagnostics",
        "version": 1,
        "eventId": _hex_identity(context, node["eventId"], "$.eventId"),
        "queryId": _hex_identity(context, node["queryId"], "$.queryId"),
        "terminalReason": _choice(
            context, node["terminalReason"], "$.terminalReason", _TERMINAL_REASONS
        ),
        "attempts": _bounded_count(context, node["attempts"], "$.attempts", 1, _MAX_ATTEMPTS),
    }
    if "runtimeIdentity" in node:
        diagnostics["runtimeIdentity"] = _hex_identity(
            context, node["runtimeIdentity"], "$.runtimeIdentity"
        )
    if "debugQuery" in node:
        diagnostics["debugQuery"] = _bounded_text(
            context,
            node["debugQuery"],
            "$.debugQuery",
            limits.max_debug_bytes,
            allow_line_breaks=True,
        )
    if "safeMessage" in node:
        diagnostics["safeMessage"] = _bounded_text(
            context, node["safeMessage"], "$.safeMessage", limits.max_string_bytes
        )
    return diagnostics
