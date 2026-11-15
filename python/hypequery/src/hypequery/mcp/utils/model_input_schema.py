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
    dataset, no metric); such a tool is left out of `tools/list`. Checked on the
    model-ready form, so constraint-only combinators beside the requirement are
    already gone and cannot hide it.
    """

    model = to_model_input_schema(dict(schema))
    properties = _properties_of(model)
    return any(_same(properties.get(name), {"not": {}}) for name in _required_of(model))


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
        # Each distinct schema this property takes, with the targets that offer it.
        options: dict[str, tuple[object, list[tuple[str, str]], list[int]]] = {}
        for variant in variants:
            if name not in _properties_of(variant):
                continue
            prop = _properties_of(variant)[name]
            _, targets, count = options.setdefault(_key(prop), (prop, [], [0]))
            target = _target_of(variant)
            if target is not None and all(other[1] != target[1] for other in targets):
                targets.append(target)
            count[0] += 1
        offered = list(options.values())
        # A property that is the same for every variant needs no label, nor do the
        # properties that pick the variant.
        label = name not in _TARGET_KEYS and (len(offered) > 1 or offered[0][2][0] < len(variants))
        schemas = [
            _labelled(schema, targets) if label else schema for schema, targets, _ in offered
        ]
        properties[name] = schemas[0] if len(schemas) == 1 else {"anyOf": schemas}
    shared = [
        name
        for name in dict.fromkeys(_required_of(variants[0]))
        if all(name in _required_of(variant) for variant in variants[1:])
    ]
    accepted: JsonObject = {"type": "object", "properties": properties, **_definitions_of(variants)}
    if shared:
        accepted["required"] = shared
    if all(variant.get("additionalProperties") is False for variant in variants):
        accepted["additionalProperties"] = False
    return accepted


#: The properties whose `const` picks a variant: `dataset`, and `metric` for `query_metric`.
_TARGET_KEYS = frozenset(("dataset", "metric"))


def _target_of(variant: Mapping[str, object]) -> tuple[str, str] | None:
    """What a variant is for, as (kind, quoted name): its metric on its dataset, or its dataset."""

    dataset = _const_of(_properties_of(variant).get("dataset"))
    metric = _const_of(_properties_of(variant).get("metric"))
    if metric is not None:
        name = _quote(metric) if dataset is None else f"{_quote(metric)} on {_quote(dataset)}"
        return ("metric", name)
    return None if dataset is None else ("dataset", _quote(dataset))


def _const_of(schema: object) -> str | None:
    if isinstance(schema, Mapping) and isinstance(schema.get("const"), str):
        return cast(str, schema["const"])
    return None


def _labelled(schema: object, targets: list[tuple[str, str]]) -> object:
    """Says which datasets (or metrics) an option is for, which the flat schema cannot enforce.

    The server still does; the label lets the model get it right first.
    """

    if not isinstance(schema, Mapping) or not targets:
        return schema
    kind = targets[0][0]
    names = ", ".join(name for _, name in targets)
    which = f"{kind if len(targets) == 1 else kind + 's'} {names}"
    label = f"None for {which}." if schema.get("maxItems") == 0 else f"For {which} only."
    existing = schema.get("description")
    return {**schema, "description": f"{label} {existing}" if isinstance(existing, str) else label}


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


def _same(left: object, right: object) -> bool:
    return _key(left) == _key(right)


def _key(schema: object) -> str:
    """JSON with object keys sorted, equal to TypeScript's for equal schemas."""

    return json.dumps(_integral(schema), sort_keys=True, default=str)


def _integral(value: object) -> object:
    # JavaScript writes 1.0 as 1; so must the comparison key.
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, Mapping):
        return {key: _integral(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_integral(item) for item in value]
    return value


def _quote(name: str) -> str:
    return json.dumps(name, ensure_ascii=False)
