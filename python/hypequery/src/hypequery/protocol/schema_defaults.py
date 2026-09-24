"""Whether a schema's declared default is a value that schema accepts.

A default is execution behaviour: it is the value a caller receives when they
omit the field, so a default the schema would itself reject is a contract that
can never be satisfied. This check runs at validation time, on the already
canonical default, so the mismatch surfaces when the schema is built rather
than when a request arrives.
"""

from __future__ import annotations

from collections.abc import Mapping

from .expression_models import FrozenCanonicalValue
from .schema_models import (
    ProtocolAnySchema,
    ProtocolArraySchema,
    ProtocolBooleanSchema,
    ProtocolEnumSchema,
    ProtocolLiteralSchema,
    ProtocolNullSchema,
    ProtocolNumberSchema,
    ProtocolObjectSchema,
    ProtocolRecordSchema,
    ProtocolSchema,
    ProtocolStringSchema,
    ProtocolVoidSchema,
)
from .values import encode_canonical_value_to_string

_SAFE_INTEGER = 2**53 - 1


def _tagged(value: FrozenCanonicalValue, tag_type: str, field: str) -> tuple[object, ...] | None:
    """Return a tagged composite's payload, or ``None`` if it is not that tag."""

    if not isinstance(value, Mapping):
        return None
    tag = value.get("$hypequery")
    if not isinstance(tag, Mapping) or tag.get("type") != tag_type:
        return None
    payload = tag.get(field)
    return payload if type(payload) is tuple else None


def _encoded(value: FrozenCanonicalValue) -> str:
    return encode_canonical_value_to_string(_thaw(value))


def _thaw(value: FrozenCanonicalValue) -> object:
    if type(value) is tuple:
        return [_thaw(item) for item in value]
    if isinstance(value, Mapping):
        return {key: _thaw(item) for key, item in value.items()}
    return value


def _matches_number(schema: ProtocolNumberSchema, value: FrozenCanonicalValue) -> bool:
    if type(value) is not float:
        return False
    if schema.kind == "integer" and not (value.is_integer() and abs(value) <= _SAFE_INTEGER):
        return False
    return (
        (schema.minimum is None or value >= schema.minimum)
        and (schema.exclusive_minimum is None or value > schema.exclusive_minimum)
        and (schema.maximum is None or value <= schema.maximum)
        and (schema.exclusive_maximum is None or value < schema.exclusive_maximum)
    )


def _matches_object(schema: ProtocolObjectSchema, value: FrozenCanonicalValue) -> bool:
    entries = _tagged(value, "map", "entries")
    if entries is None:
        return False
    found: set[str] = set()
    for entry in entries:
        if type(entry) is not tuple or len(entry) != 2:
            return False
        key, item = entry
        if type(key) is not str or key in found:
            return False
        declared = schema.property_schema(key)
        if declared is not None:
            if not schema_accepts_default(declared, item):
                return False
            found.add(key)
        elif schema.unknown_properties != "preserve":
            return False
    return all(name in found for name in schema.required)


def _matches_record(schema: ProtocolRecordSchema, value: FrozenCanonicalValue) -> bool:
    entries = _tagged(value, "map", "entries")
    if entries is None:
        return False
    found: set[str] = set()
    for entry in entries:
        if type(entry) is not tuple or len(entry) != 2:
            return False
        key, item = entry
        if type(key) is not str or key in found or not schema_accepts_default(schema.values, item):
            return False
        found.add(key)
    return True


def schema_accepts_default(schema: ProtocolSchema, value: FrozenCanonicalValue) -> bool:
    """Return whether *schema* accepts the canonical *value* as a default."""

    if isinstance(schema, ProtocolAnySchema):
        return True
    if isinstance(schema, ProtocolVoidSchema):
        # `void` means "no value at all", so nothing can stand in for one.
        return False
    if isinstance(schema, ProtocolNullSchema):
        return value is None
    if isinstance(schema, ProtocolBooleanSchema):
        return type(value) is bool
    if isinstance(schema, ProtocolStringSchema):
        if type(value) is not str:
            return False
        length = len(value)
        return (schema.min_length is None or length >= schema.min_length) and (
            schema.max_length is None or length <= schema.max_length
        )
    if isinstance(schema, ProtocolNumberSchema):
        return _matches_number(schema, value)
    if isinstance(schema, ProtocolLiteralSchema):
        return _encoded(value) == _encoded(schema.value)
    if isinstance(schema, ProtocolEnumSchema):
        encoded = _encoded(value)
        return any(_encoded(item) == encoded for item in schema.values)
    if isinstance(schema, ProtocolArraySchema):
        items = _tagged(value, "array", "values")
        if items is None:
            return False
        count = len(items)
        return (
            (schema.min_items is None or count >= schema.min_items)
            and (schema.max_items is None or count <= schema.max_items)
            and all(schema_accepts_default(schema.items, item) for item in items)  # type: ignore[arg-type]
        )
    if isinstance(schema, ProtocolObjectSchema):
        return _matches_object(schema, value)
    if isinstance(schema, ProtocolRecordSchema):
        return _matches_record(schema, value)
    # Every other kind is handled above, so the union is all that is left.
    return any(schema_accepts_default(variant, value) for variant in schema.variants)
