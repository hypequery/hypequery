"""Strict validation of the business context v1 document.

Business context is reviewed, descriptive guidance for analysts and agents:
what the business does, its KPIs, its glossary, reporting conventions and
known data caveats. It travels beside the deployment contract but is never part
of it: the data plane never reads it, and changing it never changes what a
query returns.

Mirrors `@hypequery/protocol`'s `validateProtocolBusinessContext` rule for rule,
with JavaScript string semantics where Python's differ: `trim` and `\\s` are
ECMAScript's whitespace set, and text length counts UTF-16 code units.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, fields
from typing import Literal, NotRequired, TypedDict, cast

from .errors import business_context_error
from .js_strings import collapse_js_whitespace, js_trim, utf16_length


class ProtocolBusinessContextKpi(TypedDict):
    """A number the business watches, with its business definition."""

    name: str
    definition: str


class ProtocolBusinessContextGlossaryTerm(TypedDict):
    """A business term and what it means in this organisation."""

    term: str
    meaning: str


class ProtocolBusinessContext(TypedDict):
    """Reviewed business context, as `validate_protocol_business_context` returns it."""

    kind: Literal["hypequery-business-context"]
    version: Literal[1]
    #: What the business does, in a few sentences.
    summary: NotRequired[str]
    industry: NotRequired[str]
    #: How the business makes money.
    businessModel: NotRequired[str]
    #: Who it sells to, and its main segments.
    customers: NotRequired[str]
    #: Who asks the questions: roles and teams.
    audience: NotRequired[str]
    #: Decisions and recurring questions the data should help with.
    goals: NotRequired[list[str]]
    #: The numbers the business watches, with their business definition.
    kpis: NotRequired[list[ProtocolBusinessContextKpi]]
    #: Business terms and what they mean in this organisation.
    glossary: NotRequired[list[ProtocolBusinessContextGlossaryTerm]]
    #: Reporting conventions: currency, time zone, fiscal year, week start.
    conventions: NotRequired[str]
    #: Known data quirks, e.g. test orders or refunds stored elsewhere.
    caveats: NotRequired[list[str]]


_MAXIMUMS = {
    "max_text_length": 4_096,
    "max_items": 100,
    "max_bytes": 1_024 * 1_024,
}


@dataclass(frozen=True, slots=True)
class ProtocolBusinessContextLimits:
    """Limits that may tighten, but never raise, the business context v1 ceilings.

    *max_text_length* counts UTF-16 code units, as JavaScript's ``length`` does;
    *max_items* bounds every list; *max_bytes* bounds the canonical UTF-8 encoding.
    """

    max_text_length: int = _MAXIMUMS["max_text_length"]
    max_items: int = _MAXIMUMS["max_items"]
    max_bytes: int = _MAXIMUMS["max_bytes"]

    def __post_init__(self) -> None:
        for limit in fields(self):
            value = getattr(self, limit.name)
            maximum = _MAXIMUMS[limit.name]
            if type(value) is not int or value < 1 or value > maximum:
                msg = (
                    f"{limit.name} must be a positive integer no greater than {maximum} "
                    "(the business context v1 maximum)"
                )
                raise ValueError(msg)


#: Matches the limits Cloud onboarding already enforces on business profiles.
DEFAULT_PROTOCOL_BUSINESS_CONTEXT_LIMITS = ProtocolBusinessContextLimits()

BUSINESS_CONTEXT_KIND = "hypequery-business-context"
_TEXT_FIELDS = ("summary", "industry", "businessModel", "customers", "audience", "conventions")
_TEXT_LIST_FIELDS = ("goals", "caveats")
_FIELD_ORDER = (
    "summary",
    "industry",
    "businessModel",
    "customers",
    "audience",
    "goals",
    "kpis",
    "glossary",
    "conventions",
    "caveats",
)
_ALLOWED_FIELDS = frozenset(("kind", "version", *_FIELD_ORDER))
#: C0/C1 controls other than tab and newline, which have no meaning in prose.
_CONTROL_CHARACTER = re.compile("[\x00-\x08\x0b-\x1f\x7f-\x9f]")
_SURROGATE = re.compile("[\ud800-\udfff]")


def _record(value: object, path: str) -> dict[str, object]:
    if type(value) is dict:
        if any(type(key) is not str for key in value):
            business_context_error("HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT", path)
        return cast(dict[str, object], value)
    if value is None or type(value) in (bool, str, int, float, list):
        business_context_error("HQ_BUSINESS_CONTEXT_TYPE", path)
    business_context_error("HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT", path)


def _array(value: object, path: str, max_items: int) -> list[object]:
    if type(value) is not list:
        if value is None or type(value) in (bool, str, int, float, dict):
            business_context_error("HQ_BUSINESS_CONTEXT_TYPE", path)
        business_context_error("HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT", path)
    items = cast(list[object], value)
    if len(items) > max_items:
        business_context_error("HQ_BUSINESS_CONTEXT_TOO_MANY_ITEMS", path)
    return items


def _exact_fields(value: dict[str, object], allowed: frozenset[str], path: str) -> None:
    for key in value:
        if key not in allowed:
            business_context_error("HQ_BUSINESS_CONTEXT_UNKNOWN_FIELD", f"{path}.{key}")


def _joined_surrogates(value: str) -> str | None:
    """*value* with split UTF-16 pairs joined, or None when a surrogate is unpaired.

    JavaScript sees a high and low surrogate side by side as one character, so
    a Python string holding them separately is the same text.
    """

    if _SURROGATE.search(value) is None:
        return value
    try:
        return value.encode("utf-16-le", "surrogatepass").decode("utf-16-le")
    except UnicodeDecodeError:
        return None


def _text(value: object, path: str, limits: ProtocolBusinessContextLimits) -> str:
    """Trimmed, non-empty prose without control characters or broken UTF-16."""

    if type(value) is not str:
        business_context_error("HQ_BUSINESS_CONTEXT_TYPE", path)
    trimmed = js_trim(value)
    joined = _joined_surrogates(trimmed)
    if not trimmed or _CONTROL_CHARACTER.search(trimmed) is not None or joined is None:
        business_context_error("HQ_BUSINESS_CONTEXT_INVALID_VALUE", path)
    if utf16_length(joined) > limits.max_text_length:
        business_context_error("HQ_BUSINESS_CONTEXT_TOO_LARGE", path)
    return joined


def _term_key(value: str) -> str:
    """Case- and whitespace-insensitive key used to reject ambiguous duplicate terms."""

    return collapse_js_whitespace(unicodedata.normalize("NFKC", value).lower())


def _text_list(value: object, path: str, limits: ProtocolBusinessContextLimits) -> list[str]:
    items = _array(value, path, limits.max_items)
    return [_text(item, f"{path}[{index}]", limits) for index, item in enumerate(items)]


def _pairs(
    value: object,
    path: str,
    key_field: str,
    value_field: str,
    limits: ProtocolBusinessContextLimits,
) -> list[dict[str, str]]:
    items = _array(value, path, limits.max_items)
    allowed = frozenset((key_field, value_field))
    seen: set[str] = set()
    result: list[dict[str, str]] = []
    for index, item in enumerate(items):
        item_path = f"{path}[{index}]"
        record = _record(item, item_path)
        _exact_fields(record, allowed, item_path)
        for field in (key_field, value_field):
            if field not in record:
                business_context_error("HQ_BUSINESS_CONTEXT_TYPE", f"{item_path}.{field}")
        key = _text(record[key_field], f"{item_path}.{key_field}", limits)
        normalized = _term_key(key)
        if normalized in seen:
            business_context_error("HQ_BUSINESS_CONTEXT_DUPLICATE", f"{item_path}.{key_field}")
        seen.add(normalized)
        meaning = _text(record[value_field], f"{item_path}.{value_field}", limits)
        result.append({key_field: key, value_field: meaning})
    return result


def _header(node: dict[str, object]) -> None:
    kind = node.get("kind")
    if type(kind) is not str or kind != BUSINESS_CONTEXT_KIND:
        business_context_error("HQ_BUSINESS_CONTEXT_TYPE", "$.kind")
    version = node.get("version")
    if type(version) is bool or type(version) not in (int, float) or version != 1:
        business_context_error("HQ_BUSINESS_CONTEXT_INVALID_VERSION", "$.version")


def validate_protocol_business_context(
    value: object,
    *,
    limits: ProtocolBusinessContextLimits = DEFAULT_PROTOCOL_BUSINESS_CONTEXT_LIMITS,
) -> ProtocolBusinessContext:
    """Validate and canonicalise a business context document.

    Canonical form trims text, omits empty lists and keeps author order, so two
    inputs that differ only in those respects share one identity. Raises
    `ProtocolBusinessContextError` naming the offending path.
    """

    node = _record(value, "$")
    _exact_fields(node, _ALLOWED_FIELDS, "$")
    _header(node)

    fields_: dict[str, object] = {}
    for key in _TEXT_FIELDS:
        if key in node:
            fields_[key] = _text(node[key], f"$.{key}", limits)
    for key in _TEXT_LIST_FIELDS:
        if key in node:
            items = _text_list(node[key], f"$.{key}", limits)
            if items:
                fields_[key] = items
    for key, key_field, value_field in (
        ("kpis", "name", "definition"),
        ("glossary", "term", "meaning"),
    ):
        if key in node:
            pairs = _pairs(node[key], f"$.{key}", key_field, value_field, limits)
            if pairs:
                fields_[key] = pairs

    ordered: dict[str, object] = {"kind": BUSINESS_CONTEXT_KIND, "version": 1}
    for key in _FIELD_ORDER:
        if key in fields_:
            ordered[key] = fields_[key]
    return cast(ProtocolBusinessContext, ordered)


def is_empty_protocol_business_context(context: ProtocolBusinessContext) -> bool:
    """True when the document carries no authored content beyond its header."""

    return all(key not in context for key in _FIELD_ORDER)
