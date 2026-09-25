"""Strict RFC 0004 portable query schema validation.

Validation accepts plain data only and returns a detached, deeply immutable
snapshot. It never invokes mapping hooks, serializers, callbacks, or arbitrary
functions, and it never compiles a pattern or evaluates a constraint expression
— version 1 has no regular expressions or format names precisely because their
semantics differ across languages.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, cast

from .errors import ProtocolIdentifierError, ProtocolValueError, schema_error
from .expression_models import (
    FrozenCanonicalValue,
    freeze_canonical_value,
    thaw_canonical_value,
)
from .identifiers import ProtocolIdentifier, parse_protocol_identifier
from .schema_defaults import schema_accepts_default
from .schema_models import (
    DEFAULT_PROTOCOL_SCHEMA_LIMITS,
    UNSET,
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
    ProtocolSchemaLimits,
    ProtocolStringSchema,
    ProtocolUnionSchema,
    ProtocolUnknownProperties,
    ProtocolVoidSchema,
    SchemaDefault,
)
from .utf8 import exceeds_utf8_byte_limit
from .values import encode_canonical_value_to_string, validate_canonical_value

_SAFE_INTEGER = 2**53 - 1
_UNKNOWN_PROPERTIES: tuple[ProtocolUnknownProperties, ...] = ("reject", "strip", "preserve")


@dataclass(slots=True)
class _State:
    limits: ProtocolSchemaLimits
    active: set[int]
    nodes: int = 0


@dataclass(frozen=True, slots=True)
class _Annotations:
    description: str | None
    default: SchemaDefault


def _record(value: object, path: str) -> dict[str, object]:
    if type(value) is dict:
        return cast(dict[str, object], value)
    if value is None or type(value) in (bool, str, int, float, list):
        schema_error("HQ_SCHEMA_TYPE", path)
    schema_error("HQ_SCHEMA_UNSAFE_OBJECT", path)


def _array(value: object, path: str, state: _State) -> list[object]:
    if type(value) is not list:
        if value is None or type(value) in (bool, str, int, float, dict):
            schema_error("HQ_SCHEMA_TYPE", path)
        schema_error("HQ_SCHEMA_UNSAFE_OBJECT", path)
    items = cast(list[object], value)
    if len(items) > state.limits.max_collection_items:
        schema_error("HQ_SCHEMA_TOO_MANY_ITEMS", path)
    return items


def _enter(value: dict[str, object], depth: int, state: _State, path: str) -> None:
    if depth > state.limits.max_depth:
        schema_error("HQ_SCHEMA_TOO_DEEP", path)
    state.nodes += 1
    if state.nodes > state.limits.max_nodes:
        schema_error("HQ_SCHEMA_TOO_MANY_NODES", path)
    if id(value) in state.active:
        schema_error("HQ_SCHEMA_UNSAFE_OBJECT", path)
    state.active.add(id(value))


def _exact_fields(
    value: dict[str, object], required: tuple[str, ...], optional: tuple[str, ...], path: str
) -> None:
    allowed = frozenset((*required, *optional))
    for key in value:
        if type(key) is not str:
            schema_error("HQ_SCHEMA_UNSAFE_OBJECT", path)
        if key not in allowed:
            schema_error("HQ_SCHEMA_UNKNOWN_FIELD", f"{path}.{key}")
    for key in required:
        if key not in value:
            schema_error("HQ_SCHEMA_TYPE", f"{path}.{key}")


def _canonical(value: object, path: str) -> FrozenCanonicalValue:
    try:
        return freeze_canonical_value(validate_canonical_value(value))
    except ProtocolValueError:
        schema_error("HQ_SCHEMA_INVALID_VALUE", path)


def _annotations(
    value: dict[str, object], state: _State, path: str, *, allow_default: bool = True
) -> _Annotations:
    description: str | None = None
    if "description" in value:
        raw = value["description"]
        if type(raw) is not str:
            schema_error("HQ_SCHEMA_TYPE", f"{path}.description")
        # Code points are an allocation-free lower bound on UTF-8 bytes.
        if len(raw) > state.limits.max_description_bytes or exceeds_utf8_byte_limit(
            raw, state.limits.max_description_bytes
        ):
            schema_error("HQ_SCHEMA_TOO_LARGE", f"{path}.description")
        description = cast(str, _canonical(raw, f"{path}.description"))

    default: SchemaDefault = UNSET
    if "default" in value:
        if not allow_default:
            schema_error("HQ_SCHEMA_INVALID_VALUE", f"{path}.default")
        default = _canonical(value["default"], f"{path}.default")
    return _Annotations(description=description, default=default)


def _bounded_integer(value: object, path: str) -> int:
    """A non-negative safe integer, accepting the binary64 spelling of one."""

    if type(value) is int and type(value) is not bool:
        integer = value
    elif type(value) is float and math.isfinite(value) and value.is_integer():
        integer = int(value)
    else:
        schema_error("HQ_SCHEMA_INVALID_CONSTRAINT", path)
    if integer < 0 or integer > _SAFE_INTEGER:
        schema_error("HQ_SCHEMA_INVALID_CONSTRAINT", path)
    return integer


def _finite_number(value: object, path: str, *, integer: bool) -> float:
    if type(value) is bool or type(value) not in (int, float):
        schema_error("HQ_SCHEMA_INVALID_CONSTRAINT", path)
    number = float(cast(int | float, value))
    if not math.isfinite(number) or (number == 0 and math.copysign(1.0, number) < 0):
        schema_error("HQ_SCHEMA_INVALID_CONSTRAINT", path)
    if integer and not (number.is_integer() and abs(number) <= _SAFE_INTEGER):
        schema_error("HQ_SCHEMA_INVALID_CONSTRAINT", path)
    return number


def _collection_bounds(
    value: dict[str, object], minimum_key: str, maximum_key: str, path: str
) -> tuple[int | None, int | None]:
    lower = (
        _bounded_integer(value[minimum_key], f"{path}.{minimum_key}")
        if minimum_key in value
        else None
    )
    upper = (
        _bounded_integer(value[maximum_key], f"{path}.{maximum_key}")
        if maximum_key in value
        else None
    )
    if lower is not None and upper is not None and lower > upper:
        schema_error("HQ_SCHEMA_INVALID_CONSTRAINT", path)
    return lower, upper


def _numeric_bounds(
    value: dict[str, object], path: str, *, integer: bool
) -> tuple[float | None, float | None, float | None, float | None]:
    def bound(key: str) -> float | None:
        if key not in value:
            return None
        return _finite_number(value[key], f"{path}.{key}", integer=integer)

    minimum = bound("minimum")
    exclusive_minimum = bound("exclusiveMinimum")
    maximum = bound("maximum")
    exclusive_maximum = bound("exclusiveMaximum")

    if (minimum is not None and exclusive_minimum is not None) or (
        maximum is not None and exclusive_maximum is not None
    ):
        schema_error("HQ_SCHEMA_INVALID_CONSTRAINT", path)
    lower = exclusive_minimum if exclusive_minimum is not None else minimum
    upper = exclusive_maximum if exclusive_maximum is not None else maximum
    if lower is not None and upper is not None:
        empty_at_equal = lower == upper and (
            exclusive_minimum is not None or exclusive_maximum is not None
        )
        if lower > upper or empty_at_equal:
            schema_error("HQ_SCHEMA_INVALID_CONSTRAINT", path)
    return minimum, exclusive_minimum, maximum, exclusive_maximum


def _enum_values(value: object, path: str, state: _State) -> tuple[FrozenCanonicalValue, ...]:
    items = _array(value, path, state)
    if not items:
        schema_error("HQ_SCHEMA_INVALID_CONSTRAINT", path)
    validated = tuple(_canonical(item, f"{path}[{index}]") for index, item in enumerate(items))
    encoded = {encode_canonical_value_to_string(thaw_canonical_value(item)) for item in validated}
    if len(encoded) != len(validated):
        schema_error("HQ_SCHEMA_DUPLICATE_VALUE", path)
    return validated


def _object_schema(
    value: dict[str, object], annotations: _Annotations, path: str, depth: int, state: _State
) -> ProtocolObjectSchema:
    properties = _record(value["properties"], f"{path}.properties")
    if id(properties) in state.active:
        schema_error("HQ_SCHEMA_UNSAFE_OBJECT", f"{path}.properties")
    state.active.add(id(properties))
    declared: list[tuple[ProtocolIdentifier, ProtocolSchema]] = []
    try:
        if len(properties) > state.limits.max_collection_items:
            schema_error("HQ_SCHEMA_TOO_MANY_ITEMS", f"{path}.properties")
        for name, schema in properties.items():
            try:
                identifier = parse_protocol_identifier(name)
            except ProtocolIdentifierError:
                schema_error("HQ_SCHEMA_INVALID_IDENTIFIER", f"{path}.properties")
            declared.append(
                (identifier, _validate(schema, f"{path}.properties.{name}", depth + 1, state))
            )
    finally:
        state.active.discard(id(properties))

    names = {name for name, _ in declared}
    required: list[ProtocolIdentifier] = []
    for index, entry in enumerate(_array(value["required"], f"{path}.required", state)):
        if not isinstance(entry, str) or entry not in names:
            schema_error("HQ_SCHEMA_INVALID_REQUIRED", f"{path}.required[{index}]")
        required.append(ProtocolIdentifier(entry))
    if len(set(required)) != len(required):
        schema_error("HQ_SCHEMA_INVALID_REQUIRED", f"{path}.required")

    unknown = value["unknownProperties"]
    if unknown not in _UNKNOWN_PROPERTIES:
        schema_error("HQ_SCHEMA_INVALID_CONSTRAINT", f"{path}.unknownProperties")
    return ProtocolObjectSchema(
        properties=tuple(declared),
        required=tuple(required),
        unknown_properties=unknown,
        description=annotations.description,
        default=annotations.default,
    )


def _validate(source: object, path: str, depth: int, state: _State) -> ProtocolSchema:
    value = _record(source, path)
    _enter(value, depth, state, path)
    try:
        kind = value.get("kind")
        if type(kind) is not str:
            schema_error("HQ_SCHEMA_TYPE", f"{path}.kind")
        schema = _validate_kind(kind, value, path, depth, state)
    finally:
        state.active.discard(id(value))
    if schema.kind != "void" and schema.default is not UNSET:
        if not schema_accepts_default(schema, schema.default):
            schema_error("HQ_SCHEMA_INVALID_VALUE", f"{path}.default")
    return schema


def _validate_kind(
    kind: str, value: dict[str, object], path: str, depth: int, state: _State
) -> ProtocolSchema:
    annotation_fields = ("description", "default")
    if kind in ("any", "null", "boolean"):
        _exact_fields(value, ("kind",), annotation_fields, path)
        annotations = _annotations(value, state, path)
        if kind == "any":
            return ProtocolAnySchema(
                description=annotations.description, default=annotations.default
            )
        if kind == "null":
            return ProtocolNullSchema(
                description=annotations.description, default=annotations.default
            )
        return ProtocolBooleanSchema(
            description=annotations.description, default=annotations.default
        )
    if kind == "void":
        _exact_fields(value, ("kind",), ("description",), path)
        return ProtocolVoidSchema(
            description=_annotations(value, state, path, allow_default=False).description
        )
    if kind == "string":
        _exact_fields(value, ("kind",), (*annotation_fields, "minLength", "maxLength"), path)
        annotations = _annotations(value, state, path)
        minimum, maximum = _collection_bounds(value, "minLength", "maxLength", path)
        return ProtocolStringSchema(
            description=annotations.description,
            default=annotations.default,
            min_length=minimum,
            max_length=maximum,
        )
    if kind in ("number", "integer"):
        _exact_fields(
            value,
            ("kind",),
            (*annotation_fields, "minimum", "exclusiveMinimum", "maximum", "exclusiveMaximum"),
            path,
        )
        annotations = _annotations(value, state, path)
        bounds = _numeric_bounds(value, path, integer=kind == "integer")
        return ProtocolNumberSchema(
            kind=cast(Literal["number", "integer"], kind),
            description=annotations.description,
            default=annotations.default,
            minimum=bounds[0],
            exclusive_minimum=bounds[1],
            maximum=bounds[2],
            exclusive_maximum=bounds[3],
        )
    if kind == "literal":
        _exact_fields(value, ("kind", "value"), annotation_fields, path)
        annotations = _annotations(value, state, path)
        return ProtocolLiteralSchema(
            value=_canonical(value["value"], f"{path}.value"),
            description=annotations.description,
            default=annotations.default,
        )
    if kind == "enum":
        _exact_fields(value, ("kind", "values"), annotation_fields, path)
        annotations = _annotations(value, state, path)
        return ProtocolEnumSchema(
            values=_enum_values(value["values"], f"{path}.values", state),
            description=annotations.description,
            default=annotations.default,
        )
    if kind == "array":
        _exact_fields(value, ("kind", "items"), (*annotation_fields, "minItems", "maxItems"), path)
        annotations = _annotations(value, state, path)
        items = _validate(value["items"], f"{path}.items", depth + 1, state)
        minimum, maximum = _collection_bounds(value, "minItems", "maxItems", path)
        return ProtocolArraySchema(
            items=items,
            description=annotations.description,
            default=annotations.default,
            min_items=minimum,
            max_items=maximum,
        )
    if kind == "object":
        _exact_fields(
            value, ("kind", "properties", "required", "unknownProperties"), annotation_fields, path
        )
        return _object_schema(value, _annotations(value, state, path), path, depth, state)
    if kind == "record":
        _exact_fields(value, ("kind", "values"), annotation_fields, path)
        annotations = _annotations(value, state, path)
        return ProtocolRecordSchema(
            values=_validate(value["values"], f"{path}.values", depth + 1, state),
            description=annotations.description,
            default=annotations.default,
        )
    if kind == "union":
        _exact_fields(value, ("kind", "variants"), annotation_fields, path)
        annotations = _annotations(value, state, path)
        variants = _array(value["variants"], f"{path}.variants", state)
        if len(variants) < 2:
            schema_error("HQ_SCHEMA_INVALID_CONSTRAINT", f"{path}.variants")
        return ProtocolUnionSchema(
            variants=tuple(
                _validate(variant, f"{path}.variants[{index}]", depth + 1, state)
                for index, variant in enumerate(variants)
            ),
            description=annotations.description,
            default=annotations.default,
        )
    schema_error("HQ_SCHEMA_UNKNOWN_KIND", f"{path}.kind")


def validate_protocol_schema(
    value: object,
    *,
    limits: ProtocolSchemaLimits = DEFAULT_PROTOCOL_SCHEMA_LIMITS,
) -> ProtocolSchema:
    """Validate plain data as a portable query schema and detach it."""

    return _validate(value, "$", 1, _State(limits=limits, active=set()))
