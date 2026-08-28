"""Safe Python-type constructors for RFC 0001 tagged values."""

from __future__ import annotations

import base64
from datetime import UTC, date, datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
from typing import Literal, cast
from uuid import UUID
from zoneinfo import ZoneInfo

from .errors import value_error
from .values import CanonicalValue, validate_canonical_value

TaggedValue = dict[str, object]


def _validated(tag: TaggedValue, declared_clickhouse_type: str | None = None) -> TaggedValue:
    value = validate_canonical_value(tag, declared_clickhouse_type=declared_clickhouse_type)
    return cast(TaggedValue, value)


def integer_value(
    value: int, *, bits: Literal[8, 16, 32, 64, 128, 256], signed: bool
) -> TaggedValue:
    """Create a range-checked integer tag without narrowing Python's integer."""

    if type(value) is not int or type(signed) is not bool:
        value_error("HQ_VALUE_INVALID_FORMAT")
    tag: TaggedValue = {
        "$hypequery": {
            "type": "integer",
            "version": 1,
            "bits": bits,
            "signed": signed,
            "value": str(value),
        }
    }
    declared_type = f"{'' if signed else 'U'}Int{bits}"
    return _validated(tag, declared_type)


def decimal_value(value: Decimal, *, precision: int, scale: int) -> TaggedValue:
    """Create an exact fixed-scale decimal tag without passing through float."""

    if type(value) is not Decimal or not value.is_finite():
        value_error("HQ_VALUE_INVALID_FORMAT")
    if value.is_zero() and value.is_signed():
        value_error("HQ_VALUE_INVALID_FORMAT")
    if type(precision) is not int or type(scale) is not int:
        value_error("HQ_VALUE_INVALID_FORMAT")
    if precision < 1 or precision > 76 or scale < 0 or scale > precision:
        value_error("HQ_VALUE_OUT_OF_RANGE")
    with localcontext() as context:
        context.prec = 160
        quantum = Decimal(1).scaleb(-scale)
        try:
            quantized = value.quantize(quantum)
        except InvalidOperation:
            value_error("HQ_VALUE_OUT_OF_RANGE")
        if quantized != value:
            value_error("HQ_VALUE_INVALID_FORMAT")
        coefficient = int(quantized.scaleb(scale))
    return _validated(
        {
            "$hypequery": {
                "type": "decimal",
                "version": 1,
                "coefficient": str(coefficient),
                "precision": precision,
                "scale": scale,
            }
        }
    )


def date_value(value: date, *, clickhouse_type: Literal["Date", "Date32"]) -> TaggedValue:
    """Create a date tag from a locale-independent Python date."""

    if type(value) is not date:
        value_error("HQ_VALUE_UNSAFE_OBJECT")
    return _validated(
        {
            "$hypequery": {
                "type": "date",
                "version": 1,
                "clickhouseType": clickhouse_type,
                "value": value.isoformat(),
            }
        }
    )


def datetime_value(
    value: datetime,
    *,
    clickhouse_type: Literal["DateTime", "DateTime64"],
    precision: int,
    timezone_name: str,
) -> TaggedValue:
    """Normalize an aware standard-library datetime to an RFC 3339 UTC tag."""

    if type(value) is not datetime or type(value.tzinfo) not in (timezone, ZoneInfo):
        value_error("HQ_VALUE_UNSAFE_OBJECT")
    if type(precision) is not int:
        value_error("HQ_VALUE_INVALID_FORMAT")
    if (clickhouse_type == "DateTime" and precision != 0) or (
        clickhouse_type == "DateTime64" and not 0 <= precision <= 9
    ):
        value_error("HQ_VALUE_OUT_OF_RANGE")
    utc = value.astimezone(UTC)
    if precision < 6 and utc.microsecond % (10 ** (6 - precision)) != 0:
        value_error("HQ_VALUE_INVALID_FORMAT")
    fraction = ""
    if precision > 0:
        fraction = f".{utc.microsecond:06d}"[: precision + 1]
        if precision > 6:
            fraction += "0" * (precision - 6)
    instant = utc.strftime("%Y-%m-%dT%H:%M:%S") + fraction + "Z"
    return _validated(
        {
            "$hypequery": {
                "type": "datetime",
                "version": 1,
                "clickhouseType": clickhouse_type,
                "precision": precision,
                "timezone": timezone_name,
                "value": instant,
            }
        }
    )


def uuid_value(value: UUID) -> TaggedValue:
    """Create a canonical lowercase UUID tag."""

    if type(value) is not UUID:
        value_error("HQ_VALUE_UNSAFE_OBJECT")
    return _validated({"$hypequery": {"type": "uuid", "version": 1, "value": str(value)}})


def bytes_value(value: bytes) -> TaggedValue:
    """Create an unpadded base64url byte tag."""

    if type(value) is not bytes:
        value_error("HQ_VALUE_UNSAFE_OBJECT")
    encoded = base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")
    return _validated(
        {
            "$hypequery": {
                "type": "bytes",
                "version": 1,
                "encoding": "base64url",
                "value": encoded,
            }
        }
    )


def enum_value(*, label: str, code: int, bits: Literal[8, 16]) -> TaggedValue:
    """Create an enum tag carrying both drift-detecting label and code."""

    return _validated(
        {
            "$hypequery": {
                "type": "enum",
                "version": 1,
                "bits": bits,
                "code": code,
                "label": label,
            }
        }
    )


def array_value(values: list[CanonicalValue] | tuple[CanonicalValue, ...]) -> TaggedValue:
    """Create an ordered array tag from a concrete list or tuple."""

    if type(values) not in (list, tuple):
        value_error("HQ_VALUE_UNSAFE_OBJECT")
    return _validated({"$hypequery": {"type": "array", "version": 1, "values": list(values)}})


def tuple_value(values: list[CanonicalValue] | tuple[CanonicalValue, ...]) -> TaggedValue:
    """Create an ordered tuple tag from a concrete list or tuple."""

    if type(values) not in (list, tuple):
        value_error("HQ_VALUE_UNSAFE_OBJECT")
    return _validated({"$hypequery": {"type": "tuple", "version": 1, "values": list(values)}})


def map_value(
    entries: list[tuple[CanonicalValue, CanonicalValue]]
    | tuple[tuple[CanonicalValue, CanonicalValue], ...],
) -> TaggedValue:
    """Create an ordered map tag while preserving duplicate keys."""

    if type(entries) not in (list, tuple):
        value_error("HQ_VALUE_UNSAFE_OBJECT")
    normalized: list[object] = []
    for entry in entries:
        if type(entry) not in (list, tuple) or len(entry) != 2:
            value_error("HQ_VALUE_INVALID_FORMAT")
        normalized.append([entry[0], entry[1]])
    return _validated({"$hypequery": {"type": "map", "version": 1, "entries": normalized}})
