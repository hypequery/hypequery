"""A tool's input schema as model providers accept it, as `@hypequery/mcp` advertises it.

Anthropic rejects an input schema that is not valid JSON Schema draft 2020-12,
or that has `anyOf`, `oneOf` or `allOf` at the top,
and `query_dataset` has one variant per dataset. The variants merge into one
object: a property in several variants offers each of their schemas.
Constraints that need a top-level combinator, such as "this dataset's fields
only", are dropped here; the server validates every call against the exact
schema and returns a correctable error, so the model learns them from the
result instead.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import cast

JsonObject = dict[str, object]


_COMBINATORS = ("anyOf", "oneOf", "allOf")
#: Where a schema keeps the subschemas its `$ref`s point at; carried through so
#: no reference breaks.
_DEFINITIONS = ("$defs", "definitions")


def to_model_input_schema(schema: JsonObject) -> JsonObject:
    """Valid draft 2020-12, and one object schema with no top-level combinator."""

    current = cast(JsonObject, _to_draft_2020_12(schema))
    return _flatten(current) if any(key in current for key in _COMBINATORS) else current


#: Keywords whose values are data, not subschemas; left exactly as they are.
_DATA_KEYWORDS = frozenset(("const", "enum", "default", "examples"))


def _to_draft_2020_12(value: object) -> object:
    """Rewrites draft-07 tuples, which the exact schemas use for `between` values.

    `items: [a, b]` becomes `prefixItems: [a, b]`, and `additionalItems: false`
    becomes `items: false`. Model APIs (and MCP) read 2020-12, where an array
    under `items` is invalid and the request fails.
    """

    if isinstance(value, list):
        return [_to_draft_2020_12(item) for item in value]
    if not isinstance(value, Mapping):
        return value
    result: JsonObject = {
        key: child if key in _DATA_KEYWORDS else _to_draft_2020_12(child)
        for key, child in value.items()
    }
    if isinstance(result.get("items"), list):
        result["prefixItems"] = result.pop("items")
        if "additionalItems" in result:
            result["items"] = result.pop("additionalItems")
    return result


def accepts_no_input(schema: Mapping[str, object]) -> bool:
    """Whether no input can satisfy `schema`: it requires a property whose schema is `{"not": {}}`.

    A query tool compiles to that when nothing is offered under it (no queryable
    dataset, no metric); such a tool is left out of `tools/list`.
    """

    if any(key in schema for key in _COMBINATORS):
        return False
    properties = _properties_of(schema)
    return any(_same(properties.get(name), {"not": {}}) for name in _required_of(schema))


def _flatten(schema: Mapping[str, object]) -> JsonObject:
    result: JsonObject = {key: value for key, value in schema.items() if key not in _COMBINATORS}
    result["type"] = "object"
    # Every allOf member holds, so object members merge in. Members that are only
    # constraints (a combinator with no properties of its own) are left to the server.
    for member in _schemas_in(schema.get("allOf")):
        if isinstance(member.get("properties"), Mapping):
            result = _intersect(result, _flatten(member))
    # anyOf and oneOf both hold when both are present, so each narrows the result.
    for key in ("anyOf", "oneOf"):
        alternatives = _schemas_in(schema.get(key))
        if alternatives:
            result = _intersect(result, _union([_flatten(variant) for variant in alternatives]))
    return result


def _union(variants: Sequence[JsonObject]) -> JsonObject:
    """One object accepting what any variant accepts."""

    properties: JsonObject = {}
    for name in dict.fromkeys(name for variant in variants for name in _properties_of(variant)):
        options = _distinct(
            [_properties_of(v)[name] for v in variants if name in _properties_of(v)]
        )
        properties[name] = options[0] if len(options) == 1 else {"anyOf": options}
    shared = [
        name
        for name in _required_of(variants[0])
        if all(name in _required_of(variant) for variant in variants[1:])
    ]
    accepted: JsonObject = {"type": "object", "properties": properties, **_definitions_of(variants)}
    if shared:
        accepted["required"] = shared
    if all(variant.get("additionalProperties") is False for variant in variants):
        accepted["additionalProperties"] = False
    return accepted


def _intersect(left: JsonObject, right: JsonObject) -> JsonObject:
    """One object holding both schemas' properties and requirements."""

    properties: JsonObject = dict(_properties_of(left))
    for name, prop in _properties_of(right).items():
        existing = properties.get(name)
        properties[name] = (
            prop if existing is None or _same(existing, prop) else {"allOf": [existing, prop]}
        )
    required = list(dict.fromkeys([*_required_of(left), *_required_of(right)]))
    merged: JsonObject = {**right, **left, **_definitions_of([left, right]), "type": "object"}
    if properties:
        merged["properties"] = properties
    if required:
        merged["required"] = required
    if left.get("additionalProperties") is False or right.get("additionalProperties") is False:
        merged["additionalProperties"] = False
    return merged


def _definitions_of(schemas: Sequence[Mapping[str, object]]) -> JsonObject:
    found: JsonObject = {}
    for key in _DEFINITIONS:
        merged: JsonObject = {}
        for schema in schemas:
            value = schema.get(key)
            if isinstance(value, Mapping):
                merged.update(value)
        if merged:
            found[key] = merged
    return found


def _schemas_in(value: object) -> list[JsonObject]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, Mapping)]


def _properties_of(schema: Mapping[str, object]) -> Mapping[str, object]:
    properties = schema.get("properties")
    return properties if isinstance(properties, Mapping) else {}


def _required_of(schema: Mapping[str, object]) -> list[str]:
    required = schema.get("required")
    if not isinstance(required, list):
        return []
    return [name for name in required if isinstance(name, str)]


def _distinct(schemas: Sequence[object]) -> list[object]:
    return list({_key(schema): schema for schema in schemas}.values())


def _same(left: object, right: object) -> bool:
    return _key(left) == _key(right)


def _key(schema: object) -> str:
    return json.dumps(schema, sort_keys=True, default=str)
