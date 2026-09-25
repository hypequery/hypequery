"""Immutable RFC 0004 portable query schema values.

Schemas describe sets of accepted wire values. They carry no validators,
callbacks, regular expressions, or source text — only the closed node
vocabulary — so a schema can cross a language boundary without carrying
executable behaviour with it.
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from dataclasses import field as dataclass_field
from enum import Enum
from typing import Literal, TypeAlias

from .expression_models import FrozenCanonicalValue, thaw_canonical_value
from .identifiers import ProtocolIdentifier


class _Unset(Enum):
    """A one-member enum so ``mypy`` can narrow the absent-default marker."""

    ABSENT = "absent"


#: Marks an annotation as absent. A schema whose ``default`` is ``None`` has a
#: default of JSON ``null``, which is a different thing entirely.
UNSET = _Unset.ABSENT

SchemaDefault: TypeAlias = FrozenCanonicalValue | Literal[_Unset.ABSENT]
ProtocolUnknownProperties: TypeAlias = Literal["reject", "strip", "preserve"]
ProtocolSchemaKind: TypeAlias = Literal[
    "any",
    "void",
    "null",
    "boolean",
    "string",
    "number",
    "integer",
    "literal",
    "enum",
    "array",
    "object",
    "record",
    "union",
]


@dataclass(frozen=True, slots=True)
class ProtocolAnySchema:
    description: str | None = None
    default: SchemaDefault = UNSET
    kind: Literal["any"] = dataclass_field(init=False, default="any")


@dataclass(frozen=True, slots=True)
class ProtocolVoidSchema:
    """No value at all. Distinct from ``null``, and never carries a default."""

    description: str | None = None
    kind: Literal["void"] = dataclass_field(init=False, default="void")


@dataclass(frozen=True, slots=True)
class ProtocolNullSchema:
    description: str | None = None
    default: SchemaDefault = UNSET
    kind: Literal["null"] = dataclass_field(init=False, default="null")


@dataclass(frozen=True, slots=True)
class ProtocolBooleanSchema:
    description: str | None = None
    default: SchemaDefault = UNSET
    kind: Literal["boolean"] = dataclass_field(init=False, default="boolean")


@dataclass(frozen=True, slots=True)
class ProtocolStringSchema:
    description: str | None = None
    default: SchemaDefault = UNSET
    min_length: int | None = None
    max_length: int | None = None
    kind: Literal["string"] = dataclass_field(init=False, default="string")


@dataclass(frozen=True, slots=True)
class ProtocolNumberSchema:
    """A finite JSON number, or a safe JSON integer when ``kind`` is integer.

    The integer meaning here is the API-schema one; it is separate from the
    width-aware ClickHouse integer tag that result values use.
    """

    kind: Literal["number", "integer"] = "number"
    description: str | None = None
    default: SchemaDefault = UNSET
    minimum: float | None = None
    exclusive_minimum: float | None = None
    maximum: float | None = None
    exclusive_maximum: float | None = None


@dataclass(frozen=True, slots=True)
class ProtocolLiteralSchema:
    value: FrozenCanonicalValue
    description: str | None = None
    default: SchemaDefault = UNSET
    kind: Literal["literal"] = dataclass_field(init=False, default="literal")


@dataclass(frozen=True, slots=True)
class ProtocolEnumSchema:
    values: tuple[FrozenCanonicalValue, ...]
    description: str | None = None
    default: SchemaDefault = UNSET
    kind: Literal["enum"] = dataclass_field(init=False, default="enum")


@dataclass(frozen=True, slots=True)
class ProtocolArraySchema:
    items: ProtocolSchema
    description: str | None = None
    default: SchemaDefault = UNSET
    min_items: int | None = None
    max_items: int | None = None
    kind: Literal["array"] = dataclass_field(init=False, default="array")


@dataclass(frozen=True, slots=True)
class ProtocolObjectSchema:
    properties: tuple[tuple[ProtocolIdentifier, ProtocolSchema], ...]
    required: tuple[ProtocolIdentifier, ...]
    unknown_properties: ProtocolUnknownProperties
    description: str | None = None
    default: SchemaDefault = UNSET
    kind: Literal["object"] = dataclass_field(init=False, default="object")

    def property_schema(self, name: str) -> ProtocolSchema | None:
        """Return the schema declared for *name*, or ``None`` if undeclared."""

        for declared, schema in self.properties:
            if declared == name:
                return schema
        return None


@dataclass(frozen=True, slots=True)
class ProtocolRecordSchema:
    values: ProtocolSchema
    description: str | None = None
    default: SchemaDefault = UNSET
    kind: Literal["record"] = dataclass_field(init=False, default="record")


@dataclass(frozen=True, slots=True)
class ProtocolUnionSchema:
    variants: tuple[ProtocolSchema, ...]
    description: str | None = None
    default: SchemaDefault = UNSET
    kind: Literal["union"] = dataclass_field(init=False, default="union")


ProtocolSchema: TypeAlias = (
    ProtocolAnySchema
    | ProtocolVoidSchema
    | ProtocolNullSchema
    | ProtocolBooleanSchema
    | ProtocolStringSchema
    | ProtocolNumberSchema
    | ProtocolLiteralSchema
    | ProtocolEnumSchema
    | ProtocolArraySchema
    | ProtocolObjectSchema
    | ProtocolRecordSchema
    | ProtocolUnionSchema
)

_SCHEMA_MAXIMUMS = {
    "max_depth": 16,
    "max_nodes": 1_000,
    "max_collection_items": 100,
    "max_description_bytes": 4_096,
}


@dataclass(frozen=True, slots=True)
class ProtocolSchemaLimits:
    """Product limits that may lower, but never raise, RFC 0004 limits."""

    max_depth: int = _SCHEMA_MAXIMUMS["max_depth"]
    max_nodes: int = _SCHEMA_MAXIMUMS["max_nodes"]
    max_collection_items: int = _SCHEMA_MAXIMUMS["max_collection_items"]
    max_description_bytes: int = _SCHEMA_MAXIMUMS["max_description_bytes"]

    def __post_init__(self) -> None:
        for limit in fields(self):
            value = getattr(self, limit.name)
            maximum = _SCHEMA_MAXIMUMS[limit.name]
            if type(value) is not int or value < 1 or value > maximum:
                msg = (
                    f"{limit.name} must be a positive integer no greater than "
                    "the protocol v1 maximum"
                )
                raise ValueError(msg)


DEFAULT_PROTOCOL_SCHEMA_LIMITS = ProtocolSchemaLimits()


def schema_to_data(schema: ProtocolSchema) -> dict[str, object]:
    """Serialize a validated schema back into detached protocol data.

    Field spellings are the protocol's, not Python's, so the result is what
    canonical encoding and the wire both expect.
    """

    data: dict[str, object] = {"kind": schema.kind}
    if schema.description is not None:
        data["description"] = schema.description
    if not isinstance(schema, ProtocolVoidSchema) and schema.default is not UNSET:
        data["default"] = thaw_canonical_value(schema.default)

    if isinstance(schema, ProtocolStringSchema):
        _put(data, minLength=schema.min_length, maxLength=schema.max_length)
    elif isinstance(schema, ProtocolNumberSchema):
        _put(
            data,
            minimum=schema.minimum,
            exclusiveMinimum=schema.exclusive_minimum,
            maximum=schema.maximum,
            exclusiveMaximum=schema.exclusive_maximum,
        )
    elif isinstance(schema, ProtocolLiteralSchema):
        data["value"] = thaw_canonical_value(schema.value)
    elif isinstance(schema, ProtocolEnumSchema):
        data["values"] = [thaw_canonical_value(item) for item in schema.values]
    elif isinstance(schema, ProtocolArraySchema):
        data["items"] = schema_to_data(schema.items)
        _put(data, minItems=schema.min_items, maxItems=schema.max_items)
    elif isinstance(schema, ProtocolObjectSchema):
        data["properties"] = {name: schema_to_data(item) for name, item in schema.properties}
        data["required"] = list(schema.required)
        data["unknownProperties"] = schema.unknown_properties
    elif isinstance(schema, ProtocolRecordSchema):
        data["values"] = schema_to_data(schema.values)
    elif isinstance(schema, ProtocolUnionSchema):
        data["variants"] = [schema_to_data(variant) for variant in schema.variants]
    return data


def _put(data: dict[str, object], **values: object) -> None:
    """Add only the constraints the schema actually declared."""

    data.update({key: value for key, value in values.items() if value is not None})
