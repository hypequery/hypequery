"""RFC 0001 tagged-value validation, parsing, canonicalization, and hashing."""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import date
from typing import TypeAlias, cast

from ._jcs import serialize_jcs
from .errors import ProtocolValueError, value_error
from .limits import DEFAULT_CANONICAL_VALUE_LIMITS, CanonicalValueLimits

CanonicalValue: TypeAlias = bool | str | float | int | list[object] | dict[str, object] | None

_INTEGER_BITS = frozenset((8, 16, 32, 64, 128, 256))
_BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
_INTEGER_RE = re.compile(r"^(?:0|-[1-9]\d*|[1-9]\d*)$")
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_TIMEZONE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_+-]*(?:/[A-Za-z0-9_+-]+)*$")
_INTEGER_TYPE_RE = re.compile(r"^(?:U?Int)(?:8|16|32|64|128|256)$")
_SAFE_INTEGER = 2**53 - 1
_ALLOWED_CONTROLS = frozenset((0x09, 0x0A, 0x0D))


@dataclass(slots=True)
class _SnapshotState:
    limits: CanonicalValueLimits
    active: set[int]
    nodes: int = 0


@dataclass(slots=True)
class _ValidationState:
    limits: CanonicalValueLimits
    nodes: int = 0


def _snapshot(value: object, state: _SnapshotState, path: str, syntax_depth: int) -> object:
    state.nodes += 1
    if state.nodes > state.limits.max_nodes * 16:
        value_error("HQ_VALUE_TOO_MANY_NODES", path)
    if syntax_depth > state.limits.max_depth * 4 + 8:
        value_error("HQ_VALUE_TOO_DEEP", path)

    if value is None or type(value) in (bool, str, int, float):
        return value
    if type(value) not in (dict, list):
        value_error("HQ_VALUE_UNSAFE_OBJECT", path)

    identity = id(value)
    if identity in state.active:
        value_error("HQ_VALUE_INVALID_FORMAT", path)
    state.active.add(identity)
    try:
        if type(value) is list:
            sequence = cast(list[object], value)
            if len(sequence) > state.limits.max_nodes * 2:
                value_error("HQ_VALUE_TOO_MANY_NODES", path)
            return [
                _snapshot(item, state, f"{path}[{index}]", syntax_depth + 1)
                for index, item in enumerate(sequence)
            ]

        result: dict[str, object] = {}
        mapping = cast(dict[object, object], value)
        for key, item in mapping.items():
            if type(key) is not str:
                value_error("HQ_VALUE_UNSAFE_OBJECT", path)
            result[key] = _snapshot(item, state, f"{path}.{key}", syntax_depth + 1)
        return result
    finally:
        state.active.remove(identity)


def _validate_unicode(value: str, path: str, max_bytes: int) -> None:
    for character in value:
        codepoint = ord(character)
        if 0xD800 <= codepoint <= 0xDFFF:
            value_error("HQ_VALUE_INVALID_UNICODE", path)
        if (codepoint <= 0x1F and codepoint not in _ALLOWED_CONTROLS) or (
            0x7F <= codepoint <= 0x9F
        ):
            value_error("HQ_VALUE_CONTROL_CHARACTER", path)
    try:
        byte_length = len(value.encode("utf-8"))
    except UnicodeEncodeError:
        value_error("HQ_VALUE_INVALID_UNICODE", path)
    if byte_length > max_bytes:
        value_error("HQ_VALUE_TOO_LARGE", path)


def _record(value: object, path: str) -> dict[str, object]:
    if type(value) is not dict:
        value_error("HQ_VALUE_INVALID_FORMAT", path)
    return value


def _string(value: object, path: str) -> str:
    if type(value) is not str:
        value_error("HQ_VALUE_INVALID_FORMAT", path)
    return value


def _boolean(value: object, path: str) -> bool:
    if type(value) is not bool:
        value_error("HQ_VALUE_INVALID_FORMAT", path)
    return value


def _metadata_integer(value: object, path: str) -> int:
    if type(value) is int:
        integer = value
    elif type(value) is float and math.isfinite(value) and value.is_integer():
        if value == 0 and math.copysign(1.0, value) < 0:
            value_error("HQ_VALUE_INVALID_FORMAT", path)
        integer = int(value)
    else:
        value_error("HQ_VALUE_INVALID_FORMAT", path)
    if abs(integer) > _SAFE_INTEGER:
        value_error("HQ_VALUE_INVALID_FORMAT", path)
    return integer


def _exact_fields(value: dict[str, object], fields: tuple[str, ...], path: str) -> None:
    allowed = frozenset(fields)
    for key in value:
        if key not in allowed:
            value_error("HQ_VALUE_UNKNOWN_FIELD", f"{path}.{key}")
    for field in fields:
        if field not in value:
            value_error("HQ_VALUE_INVALID_FORMAT", f"{path}.{field}")


def _integer_string(value: str, path: str) -> int:
    if _INTEGER_RE.fullmatch(value) is None:
        value_error("HQ_VALUE_INVALID_FORMAT", path)
    return int(value)


def _validate_integer_tag(
    tag: dict[str, object], path: str, declared_clickhouse_type: str | None
) -> None:
    _exact_fields(tag, ("bits", "signed", "type", "value", "version"), path)
    bits = _metadata_integer(tag["bits"], f"{path}.bits")
    if bits not in _INTEGER_BITS:
        value_error("HQ_VALUE_OUT_OF_RANGE", f"{path}.bits")
    signed = _boolean(tag["signed"], f"{path}.signed")
    integer = _integer_string(_string(tag["value"], f"{path}.value"), f"{path}.value")
    minimum = -(1 << (bits - 1)) if signed else 0
    maximum = (1 << (bits - 1)) - 1 if signed else (1 << bits) - 1
    if integer < minimum or integer > maximum:
        value_error("HQ_VALUE_OUT_OF_RANGE", f"{path}.value")
    actual_type = f"{'' if signed else 'U'}Int{bits}"
    if declared_clickhouse_type is not None and declared_clickhouse_type != actual_type:
        value_error("HQ_VALUE_TYPE_MISMATCH", path)
    tag["bits"] = bits


def _validate_decimal_tag(tag: dict[str, object], path: str) -> None:
    _exact_fields(tag, ("coefficient", "precision", "scale", "type", "version"), path)
    precision = _metadata_integer(tag["precision"], f"{path}.precision")
    scale = _metadata_integer(tag["scale"], f"{path}.scale")
    if precision < 1 or precision > 76 or scale < 0 or scale > precision:
        value_error("HQ_VALUE_OUT_OF_RANGE", path)
    coefficient = _string(tag["coefficient"], f"{path}.coefficient")
    _integer_string(coefficient, f"{path}.coefficient")
    if len(coefficient.removeprefix("-")) > precision:
        value_error("HQ_VALUE_OUT_OF_RANGE", f"{path}.coefficient")
    tag["precision"] = precision
    tag["scale"] = scale


def _validate_date_text(value: str, path: str) -> None:
    match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", value)
    if match is None:
        value_error("HQ_VALUE_INVALID_FORMAT", path)
    try:
        date(*(int(part) for part in match.groups()))
    except ValueError:
        value_error("HQ_VALUE_INVALID_FORMAT", path)


def _validate_date_tag(tag: dict[str, object], path: str) -> None:
    _exact_fields(tag, ("clickhouseType", "type", "value", "version"), path)
    clickhouse_type = _string(tag["clickhouseType"], f"{path}.clickhouseType")
    if clickhouse_type not in ("Date", "Date32"):
        value_error("HQ_VALUE_TYPE_MISMATCH", f"{path}.clickhouseType")
    value = _string(tag["value"], f"{path}.value")
    _validate_date_text(value, f"{path}.value")
    minimum, maximum = (
        ("1970-01-01", "2149-06-06") if clickhouse_type == "Date" else ("1900-01-01", "2299-12-31")
    )
    if value < minimum or value > maximum:
        value_error("HQ_VALUE_OUT_OF_RANGE", f"{path}.value")


def _validate_datetime_tag(tag: dict[str, object], path: str) -> None:
    _exact_fields(
        tag,
        ("clickhouseType", "precision", "timezone", "type", "value", "version"),
        path,
    )
    clickhouse_type = _string(tag["clickhouseType"], f"{path}.clickhouseType")
    if clickhouse_type not in ("DateTime", "DateTime64"):
        value_error("HQ_VALUE_TYPE_MISMATCH", f"{path}.clickhouseType")
    precision = _metadata_integer(tag["precision"], f"{path}.precision")
    if (clickhouse_type == "DateTime" and precision != 0) or (
        clickhouse_type == "DateTime64" and not 0 <= precision <= 9
    ):
        value_error("HQ_VALUE_OUT_OF_RANGE", f"{path}.precision")
    tag["precision"] = precision

    timezone = _string(tag["timezone"], f"{path}.timezone")
    _validate_unicode(timezone, f"{path}.timezone", 64)
    if _TIMEZONE_RE.fullmatch(timezone) is None:
        value_error("HQ_VALUE_INVALID_FORMAT", f"{path}.timezone")

    value = _string(tag["value"], f"{path}.value")
    fraction = "" if precision == 0 else rf"\.(\d{{{precision}}})"
    match = re.fullmatch(
        rf"(\d{{4}}-\d{{2}}-\d{{2}})T(\d{{2}}):(\d{{2}}):(\d{{2}}){fraction}Z",
        value,
    )
    if match is None:
        value_error("HQ_VALUE_INVALID_FORMAT", f"{path}.value")
    _validate_date_text(match.group(1), f"{path}.value")
    if int(match.group(2)) > 23 or int(match.group(3)) > 59 or int(match.group(4)) > 59:
        value_error("HQ_VALUE_INVALID_FORMAT", f"{path}.value")

    if clickhouse_type == "DateTime":
        if value < "1970-01-01T00:00:00Z" or value > "2106-02-07T06:28:15Z":
            value_error("HQ_VALUE_OUT_OF_RANGE", f"{path}.value")
        return

    suffix_min = "" if precision == 0 else f".{('0' * precision)}"
    suffix_max = "" if precision == 0 else f".{('9' * precision)}"
    minimum = f"1900-01-01T00:00:00{suffix_min}Z"
    maximum = (
        "2262-04-11T23:47:16.854775807Z" if precision == 9 else f"2299-12-31T23:59:59{suffix_max}Z"
    )
    if value < minimum or value > maximum:
        value_error("HQ_VALUE_OUT_OF_RANGE", f"{path}.value")


def _validate_scalar_tag(
    tag_type: str,
    tag: dict[str, object],
    path: str,
    limits: CanonicalValueLimits,
    declared_clickhouse_type: str | None,
) -> None:
    if tag_type == "integer":
        _validate_integer_tag(tag, path, declared_clickhouse_type)
    elif tag_type == "decimal":
        _validate_decimal_tag(tag, path)
    elif tag_type == "date":
        _validate_date_tag(tag, path)
    elif tag_type == "datetime":
        _validate_datetime_tag(tag, path)
    elif tag_type == "uuid":
        _exact_fields(tag, ("type", "value", "version"), path)
        if _UUID_RE.fullmatch(_string(tag["value"], f"{path}.value")) is None:
            value_error("HQ_VALUE_INVALID_FORMAT", f"{path}.value")
    elif tag_type == "bytes":
        _exact_fields(tag, ("encoding", "type", "value", "version"), path)
        if tag["encoding"] != "base64url":
            value_error("HQ_VALUE_INVALID_FORMAT", f"{path}.encoding")
        encoded = _string(tag["value"], f"{path}.value")
        if re.fullmatch(r"[A-Za-z0-9_-]*", encoded) is None or len(encoded) % 4 == 1:
            value_error("HQ_VALUE_INVALID_FORMAT", f"{path}.value")
        if len(encoded) % 4 == 2 and _BASE64URL_ALPHABET.index(encoded[-1]) & 0x0F:
            value_error("HQ_VALUE_INVALID_FORMAT", f"{path}.value")
        if len(encoded) % 4 == 3 and _BASE64URL_ALPHABET.index(encoded[-1]) & 0x03:
            value_error("HQ_VALUE_INVALID_FORMAT", f"{path}.value")
        if len(encoded) * 6 // 8 > limits.max_decoded_bytes:
            value_error("HQ_VALUE_TOO_LARGE", f"{path}.value")
    elif tag_type == "enum":
        _exact_fields(tag, ("bits", "code", "label", "type", "version"), path)
        bits = _metadata_integer(tag["bits"], f"{path}.bits")
        if bits not in (8, 16):
            value_error("HQ_VALUE_OUT_OF_RANGE", f"{path}.bits")
        code = _metadata_integer(tag["code"], f"{path}.code")
        if code < -(2 ** (bits - 1)) or code > 2 ** (bits - 1) - 1:
            value_error("HQ_VALUE_OUT_OF_RANGE", f"{path}.code")
        label = _string(tag["label"], f"{path}.label")
        _validate_unicode(label, f"{path}.label", limits.max_string_bytes)
        tag["bits"] = bits
        tag["code"] = code
    else:
        value_error("HQ_VALUE_UNKNOWN_TAG", f"{path}.type")


def _validate_value(
    value: object,
    state: _ValidationState,
    path: str,
    depth: int,
    declared_clickhouse_type: str | None = None,
) -> object:
    state.nodes += 1
    if state.nodes > state.limits.max_nodes:
        value_error("HQ_VALUE_TOO_MANY_NODES", path)

    if value is None or type(value) is bool:
        return value
    if type(value) is str:
        _validate_unicode(value, path, state.limits.max_string_bytes)
        return value
    if type(value) is int:
        value_error("HQ_VALUE_INTEGER_TAG_REQUIRED", path)
    if type(value) is float:
        if not math.isfinite(value):
            value_error("HQ_VALUE_NON_FINITE_FLOAT", path)
        if value == 0 and math.copysign(1.0, value) < 0:
            value_error("HQ_VALUE_NEGATIVE_ZERO", path)
        if _INTEGER_TYPE_RE.fullmatch(declared_clickhouse_type or "") is not None:
            value_error("HQ_VALUE_INTEGER_TAG_REQUIRED", path)
        return value
    if type(value) is list:
        value_error("HQ_VALUE_RAW_COMPOSITE", path)

    envelope = _record(value, path)
    _exact_fields(envelope, ("$hypequery",), path)
    tag_path = f"{path}.$hypequery"
    tag = _record(envelope["$hypequery"], tag_path)
    tag_type = _string(tag.get("type"), f"{tag_path}.type")
    version = _metadata_integer(tag.get("version"), f"{tag_path}.version")
    if version != 1:
        value_error("HQ_VALUE_UNKNOWN_TAG_VERSION", f"{tag_path}.version")
    tag["version"] = version

    if tag_type in ("array", "tuple"):
        _exact_fields(tag, ("type", "values", "version"), tag_path)
        values = tag["values"]
        if type(values) is not list:
            value_error("HQ_VALUE_INVALID_FORMAT", f"{tag_path}.values")
        if len(values) > state.limits.max_collection_items:
            value_error("HQ_VALUE_TOO_MANY_ITEMS", f"{tag_path}.values")
        next_depth = depth + 1
        if next_depth > state.limits.max_depth:
            value_error("HQ_VALUE_TOO_DEEP", path)
        tag["values"] = [
            _validate_value(item, state, f"{tag_path}.values[{index}]", next_depth)
            for index, item in enumerate(values)
        ]
    elif tag_type == "map":
        _exact_fields(tag, ("entries", "type", "version"), tag_path)
        entries = tag["entries"]
        if type(entries) is not list:
            value_error("HQ_VALUE_INVALID_FORMAT", f"{tag_path}.entries")
        if len(entries) > state.limits.max_collection_items:
            value_error("HQ_VALUE_TOO_MANY_ITEMS", f"{tag_path}.entries")
        next_depth = depth + 1
        if next_depth > state.limits.max_depth:
            value_error("HQ_VALUE_TOO_DEEP", path)
        normalized_entries: list[object] = []
        for index, entry in enumerate(entries):
            entry_path = f"{tag_path}.entries[{index}]"
            if type(entry) is not list or len(entry) != 2:
                value_error("HQ_VALUE_INVALID_FORMAT", entry_path)
            normalized_entries.append(
                [
                    _validate_value(entry[0], state, f"{entry_path}[0]", next_depth),
                    _validate_value(entry[1], state, f"{entry_path}[1]", next_depth),
                ]
            )
        tag["entries"] = normalized_entries
    else:
        _validate_scalar_tag(
            tag_type,
            tag,
            tag_path,
            state.limits,
            declared_clickhouse_type,
        )
    return envelope


def validate_canonical_value(
    value: object,
    *,
    limits: CanonicalValueLimits = DEFAULT_CANONICAL_VALUE_LIMITS,
    declared_clickhouse_type: str | None = None,
) -> CanonicalValue:
    """Validate plain data and return a detached, normalized snapshot."""

    snapshot = _snapshot(value, _SnapshotState(limits=limits, active=set()), "$", 0)
    validated = _validate_value(
        snapshot,
        _ValidationState(limits=limits),
        "$",
        0,
        declared_clickhouse_type,
    )
    return cast(CanonicalValue, validated)


def _parse_duplicate_aware_json(source: str) -> object:
    def object_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                value_error("HQ_VALUE_DUPLICATE_KEY")
            result[key] = value
        return result

    def invalid_constant(_value: str) -> object:
        value_error("HQ_VALUE_INVALID_JSON")

    try:
        return json.loads(
            source,
            object_pairs_hook=object_pairs,
            parse_int=float,
            parse_float=float,
            parse_constant=invalid_constant,
        )
    except ProtocolValueError:
        raise
    except RecursionError:
        value_error("HQ_VALUE_TOO_DEEP")
    except (json.JSONDecodeError, UnicodeError, ValueError):
        value_error("HQ_VALUE_INVALID_JSON")


def decode_canonical_value(
    value: str | bytes,
    *,
    limits: CanonicalValueLimits = DEFAULT_CANONICAL_VALUE_LIMITS,
    declared_clickhouse_type: str | None = None,
) -> CanonicalValue:
    """Parse duplicate-aware UTF-8 JSON and validate an RFC 0001 value."""

    if type(value) is bytes:
        if len(value) > limits.max_input_bytes:
            value_error("HQ_VALUE_TOO_LARGE")
        try:
            source = value.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            value_error("HQ_VALUE_INVALID_UNICODE")
    elif type(value) is str:
        try:
            encoded = value.encode("utf-8", errors="strict")
        except UnicodeEncodeError:
            value_error("HQ_VALUE_INVALID_UNICODE")
        if len(encoded) > limits.max_input_bytes:
            value_error("HQ_VALUE_TOO_LARGE")
        source = value
    else:
        value_error("HQ_VALUE_INVALID_JSON")
    if source.startswith("\ufeff"):
        value_error("HQ_VALUE_INVALID_JSON")
    return validate_canonical_value(
        _parse_duplicate_aware_json(source),
        limits=limits,
        declared_clickhouse_type=declared_clickhouse_type,
    )


def encode_canonical_value(
    value: object,
    *,
    limits: CanonicalValueLimits = DEFAULT_CANONICAL_VALUE_LIMITS,
    declared_clickhouse_type: str | None = None,
) -> bytes:
    """Validate plain data and return exact RFC 8785 canonical UTF-8 bytes."""

    validated = validate_canonical_value(
        value,
        limits=limits,
        declared_clickhouse_type=declared_clickhouse_type,
    )
    return serialize_jcs(validated, max_bytes=limits.max_canonical_bytes).encode("utf-8")


def encode_canonical_value_to_string(
    value: object,
    *,
    limits: CanonicalValueLimits = DEFAULT_CANONICAL_VALUE_LIMITS,
    declared_clickhouse_type: str | None = None,
) -> str:
    """Return the UTF-8 text form of :func:`encode_canonical_value`."""

    return encode_canonical_value(
        value,
        limits=limits,
        declared_clickhouse_type=declared_clickhouse_type,
    ).decode("utf-8")


def hash_canonical_value(
    value: object,
    *,
    limits: CanonicalValueLimits = DEFAULT_CANONICAL_VALUE_LIMITS,
    declared_clickhouse_type: str | None = None,
) -> str:
    """Return the raw lowercase SHA-256 conformance hash of canonical bytes."""

    return hashlib.sha256(
        encode_canonical_value(
            value,
            limits=limits,
            declared_clickhouse_type=declared_clickhouse_type,
        )
    ).hexdigest()
