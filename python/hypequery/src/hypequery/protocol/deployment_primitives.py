"""Shared scalar and container rules for RFC 0006 deployment contracts.

These are the checks every node in a contract reuses: what counts as a record,
an array, an exact field set, a bounded text value, and a semantic-metadata
block. They live apart from the node validators so the node rules read as the
contract rather than as parsing.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, fields
from typing import cast

from .errors import ProtocolIdentifierError, deployment_error
from .identifiers import parse_protocol_identifier, parse_protocol_qualified_identifier
from .js_strings import is_js_blank
from .utf8 import exceeds_utf8_byte_limit

_DEPLOYMENT_MAXIMUMS = {
    "max_datasets": 100,
    "max_dataset_items": 1_000,
    "max_semantic_metadata_items": 100,
    "max_text_bytes": 4_096,
    "max_source_bytes": 1_024,
    "max_path_bytes": 2_048,
}

AGGREGATIONS = frozenset(
    (
        "sum",
        "count",
        "countDistinct",
        "avg",
        "min",
        "max",
        "argMax",
        "argMin",
        "percentile",
        "stddev",
        "variance",
    )
)
OPERATORS = frozenset(("eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "between", "like"))
GRAINS = frozenset(("day", "week", "month", "quarter", "year"))
SENSITIVITIES = frozenset(("public", "internal", "confidential", "restricted"))
FIELD_TYPES = frozenset(("string", "number", "boolean", "timestamp"))
SEMANTIC_METADATA_FIELDS = (
    "examples",
    "synonyms",
    "format",
    "unit",
    "currency",
    "timezone",
    "sensitivity",
)

_SAFE_INTEGER = 2**53 - 1
_CURRENCY = re.compile(r"[A-Z]{3}\Z", re.ASCII)


@dataclass(frozen=True, slots=True)
class ProtocolDeploymentLimits:
    """Validation budgets. These may tighten, never raise, the RFC 0006 limits.

    They are not deployment capacity settings: `max_dataset_items` bounds what
    validation will read, not what a deployment may serve.
    """

    max_datasets: int = _DEPLOYMENT_MAXIMUMS["max_datasets"]
    max_dataset_items: int = _DEPLOYMENT_MAXIMUMS["max_dataset_items"]
    #: Ceiling on each semantic-metadata collection. Deliberately tighter than
    #: `max_dataset_items`: these are authoring aids.
    max_semantic_metadata_items: int = _DEPLOYMENT_MAXIMUMS["max_semantic_metadata_items"]
    max_text_bytes: int = _DEPLOYMENT_MAXIMUMS["max_text_bytes"]
    max_source_bytes: int = _DEPLOYMENT_MAXIMUMS["max_source_bytes"]
    max_path_bytes: int = _DEPLOYMENT_MAXIMUMS["max_path_bytes"]

    def __post_init__(self) -> None:
        for limit in fields(self):
            value = getattr(self, limit.name)
            maximum = _DEPLOYMENT_MAXIMUMS[limit.name]
            if type(value) is not int or value < 1 or value > maximum:
                msg = (
                    f"{limit.name} must be a positive integer no greater than "
                    "the deployment contract maximum"
                )
                raise ValueError(msg)


DEFAULT_PROTOCOL_DEPLOYMENT_LIMITS = ProtocolDeploymentLimits()


def record(value: object, path: str) -> dict[str, object]:
    """Require a plain object, rejecting anything with behaviour attached."""

    if type(value) is dict:
        return cast(dict[str, object], value)
    if value is None or type(value) in (bool, str, int, float, list):
        deployment_error("HQ_DEPLOYMENT_TYPE", path)
    deployment_error("HQ_DEPLOYMENT_UNSAFE_OBJECT", path)


def array(value: object, path: str, max_items: int) -> list[object]:
    """Require a plain array within its item budget."""

    if type(value) is not list:
        if value is None or type(value) in (bool, str, int, float, dict):
            deployment_error("HQ_DEPLOYMENT_TYPE", path)
        deployment_error("HQ_DEPLOYMENT_UNSAFE_OBJECT", path)
    items = cast(list[object], value)
    if len(items) > max_items:
        deployment_error("HQ_DEPLOYMENT_TOO_MANY_ITEMS", path)
    return items


def exact_fields(
    value: dict[str, object], required: tuple[str, ...], optional: tuple[str, ...], path: str
) -> None:
    """Reject unknown fields and require the declared ones."""

    allowed = frozenset((*required, *optional))
    for key in value:
        if type(key) is not str:
            deployment_error("HQ_DEPLOYMENT_UNSAFE_OBJECT", path)
        if key not in allowed:
            deployment_error("HQ_DEPLOYMENT_UNKNOWN_FIELD", f"{path}.{key}")
    for key in required:
        if key not in value:
            deployment_error("HQ_DEPLOYMENT_TYPE", f"{path}.{key}")


def identifier(value: object, path: str, *, qualified: bool = False) -> str:
    """Parse a portable identifier, reporting failures in deployment terms."""

    try:
        if qualified:
            return parse_protocol_qualified_identifier(value)
        return parse_protocol_identifier(value)
    except ProtocolIdentifierError:
        deployment_error("HQ_DEPLOYMENT_INVALID_IDENTIFIER", path)


def bounded_text(value: object, path: str, max_bytes: int) -> str:
    """Require non-blank, control-character-free text within its byte budget.

    Unlike SQL text, a label or description has no reason to contain a tab or
    newline, so every C0 and C1 control is rejected here.
    """

    if type(value) is not str:
        deployment_error("HQ_DEPLOYMENT_TYPE", path)
    if is_js_blank(value):
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", path)
    for character in value:
        code = ord(character)
        if code <= 0x1F or code == 0x7F or 0x80 <= code <= 0x9F:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", path)
    if len(value) > max_bytes or exceeds_utf8_byte_limit(value, max_bytes):
        deployment_error("HQ_DEPLOYMENT_TOO_LARGE", path)
    return value


def optional_text(
    value: dict[str, object],
    key: str,
    result: dict[str, object],
    path: str,
    limits: ProtocolDeploymentLimits,
) -> None:
    """Copy a declared optional text field, leaving an absent one out.

    Takes the record rather than the value so an absent key stays distinct from
    a present `null`. Python has no `undefined`, and the reference
    implementation rejects an explicit null here rather than ignoring it.
    """

    if key in value:
        result[key] = bounded_text(value[key], f"{path}.{key}", limits.max_text_bytes)


def positive_integer(value: object, path: str) -> int:
    if type(value) is bool or type(value) not in (int, float):
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", path)
    number = cast(int | float, value)
    if type(number) is float and not number.is_integer():
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", path)
    integer = int(number)
    if integer < 1 or abs(integer) > _SAFE_INTEGER:
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", path)
    return integer


def unique_strings(
    value: object,
    path: str,
    max_items: int,
    parse: Callable[[object, str], str],
) -> list[str]:
    """Parse an array of strings, rejecting duplicates."""

    result = [
        parse(item, f"{path}[{index}]") for index, item in enumerate(array(value, path, max_items))
    ]
    if len(set(result)) != len(result):
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", path)
    return result


def semantic_metadata(
    value: dict[str, object],
    result: dict[str, object],
    path: str,
    limits: ProtocolDeploymentLimits,
) -> None:
    """Copy the agent-facing metadata a node may carry.

    Sensitivity describes data; it does not enforce authorization.
    """

    def text(item: object, item_path: str) -> str:
        return bounded_text(item, item_path, limits.max_text_bytes)

    for key in ("examples", "synonyms"):
        if key in value:
            result[key] = unique_strings(
                value[key], f"{path}.{key}", limits.max_semantic_metadata_items, text
            )
    for key in ("format", "unit", "timezone"):
        optional_text(value, key, result, path, limits)
    if "currency" in value:
        currency = bounded_text(value["currency"], f"{path}.currency", limits.max_text_bytes)
        if _CURRENCY.match(currency) is None:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.currency")
        result["currency"] = currency
    if "sensitivity" in value:
        sensitivity = value["sensitivity"]
        if type(sensitivity) is not str or sensitivity not in SENSITIVITIES:
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.sensitivity")
        result["sensitivity"] = sensitivity
