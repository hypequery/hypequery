# RFC 0004: Portable query schemas

- Status: Proposed
- Version: schema extension 1

## Summary

Named queries need language-neutral input and output contracts. Zod, Pydantic,
TypeScript types, and generated OpenAPI documents are authoring or presentation
formats; none is the shared protocol authority.

This RFC defines a closed, JSON-Schema-derived schema tree. Producers lower
source-language schemas into this tree during a trusted build. Serve, Cloud,
Studio, generated clients, and agent tools can then inspect the same contract
without loading project source.

## Schema nodes

Every node contains a closed `kind` discriminator. Unknown kinds and fields are
rejected. All nodes except `void` may have a canonical `default`; every node
may have a bounded `description`.

- `any`: any JSON/protocol value.
- `void`: no value or request body. This is distinct from `null`.
- `null`, `boolean`, and `string`.
- `number`: a finite JSON number.
- `integer`: a safe JSON integer. This API-schema meaning is separate from the
  width-aware ClickHouse integer tag used for result values.
- `literal`: one exact canonical value.
- `enum`: a non-empty list of distinct canonical values.
- `array`: one `items` schema and optional inclusive item-count bounds.
- `object`: named properties, an explicit required-property list, and an
  `unknownProperties` policy of `reject`, `strip`, or `preserve`.
- `record`: arbitrary string keys whose values share one schema.
- `union`: at least two variant schemas.

String length bounds count Unicode code points. Numeric minimum and maximum
bounds are inclusive; exclusive bounds use separate fields. Inclusive and
exclusive bounds for the same side cannot both appear. Array and string bounds
are non-negative safe integers. Integer bounds must themselves be safe
integers.

Object property names are portable simple identifiers. Required names must
refer to declared properties and cannot repeat. Optionality is represented by
omission from `required`, not by an `optional` wrapper node. Nullability is a
union containing `null`.

## Authoring-language lowering

The current Serve schema surface lowers as follows:

| Serve/Zod feature | Portable representation |
| --- | --- |
| `void`, `any`, `unknown` | `void` or `any` |
| String, number, integer, boolean | Corresponding scalar node |
| `min`, `max`, positive, non-negative | Numeric or collection bounds |
| Literal and enum | `literal` and `enum` |
| Array | `array` |
| Object shape | `object.properties` and `required` |
| Optional property | Omitted from `required` |
| Default | Canonical `default` plus input optionality |
| Strict/default/passthrough object | `reject`, `strip`, or `preserve` |
| Record | `record` |
| Union and nullable | `union` |
| Schema description | `description` |

Arbitrary refinements, preprocessors, transformations, custom validators,
effects, and source-language coercions are executable code and cannot be
serialized. A producer MAY lower one only when it can prove an exact mapping to
the closed vocabulary. Otherwise bundle creation MUST fail with an actionable
diagnostic or require an explicit portable wire schema. It MUST NOT silently
drop the behavior, execute the callback in Cloud, or infer semantics from the
callback's source text.

In particular, an output transformation describes both accepted resolver
values and emitted wire values. The portable query contract describes the wire
value. If a producer cannot derive that wire schema exactly, the author must
provide it explicitly.

## Value application

A runtime schema-value parser validates ordinary JSON-compatible wire values.
It returns a detached immutable snapshot, applies defaults to absent values,
and implements object unknown-property policy before the value reaches an
implementation adapter. Composite canonical defaults are materialized as their
ordinary array or string-keyed object wire values.

`void` accepts only an absent value. Other nodes reject `undefined`, non-finite
numbers, negative zero, functions, symbols, and unsafe object graphs. String
bounds count Unicode code points as they do in the schema contract.

Union variants are attempted in declaration order. The first matching variant
defines the transformed result, and every attempted branch consumes one shared
validation budget.

## Compatibility

Schemas describe sets of accepted wire values. For an existing named query:

- an input change is caller-compatible when every value accepted by the old
  input schema is accepted by the new input schema (`old input ⊆ new input`);
- an output change is caller-compatible when every value permitted by the new
  output schema was permitted by the old output schema
  (`new output ⊆ old output`).

Metadata-only description changes do not affect value compatibility. Defaults
are execution behavior and are compatibility-significant even when the set of
accepted explicit values is unchanged. Unknown-property policy is also
significant because `strip` and `preserve` deliver different values to a query
resolver.

A later compatibility-checking extension may automate these rules. Consumers
MUST NOT substitute ordinary JSON Schema compatibility heuristics where this
RFC gives different meaning.

## Limits

| Limit | Maximum |
| --- | ---: |
| Schema depth | 16 |
| Schema nodes per validation operation | 1,000 |
| Items in one schema collection | 100 |
| UTF-8 bytes in one description | 4,096 |

Products may impose lower limits but cannot raise these limits while claiming
schema extension 1 conformance. Recursive schemas and references are not part
of version 1.

Runtime value application has separate ceilings:

| Limit | Maximum |
| --- | ---: |
| Value depth | 32 |
| Value nodes per application | 10,000 |
| Items in one value collection | 1,000 |
| UTF-8 bytes in one string or object key | 1,048,576 |

Products may lower but cannot raise these value ceilings. Error paths for
arbitrary record and preserved object keys are bounded independently from the
key itself.

## Stable failure codes

- `HQ_SCHEMA_TYPE`
- `HQ_SCHEMA_UNKNOWN_FIELD`
- `HQ_SCHEMA_UNKNOWN_KIND`
- `HQ_SCHEMA_INVALID_IDENTIFIER`
- `HQ_SCHEMA_INVALID_VALUE`
- `HQ_SCHEMA_INVALID_CONSTRAINT`
- `HQ_SCHEMA_INVALID_REQUIRED`
- `HQ_SCHEMA_DUPLICATE_VALUE`
- `HQ_SCHEMA_TOO_DEEP`
- `HQ_SCHEMA_TOO_MANY_NODES`
- `HQ_SCHEMA_TOO_MANY_ITEMS`
- `HQ_SCHEMA_TOO_LARGE`
- `HQ_SCHEMA_UNSAFE_OBJECT`
- `HQ_SCHEMA_VALUE_INVALID`

## Security

Validation returns a detached, deeply immutable snapshot. Objects with custom
prototypes, accessors, symbols, hidden properties, cycles, sparse arrays, or
extra array properties are rejected. Defaults and enum/literal values use the
canonical value protocol and inherit its limits and failure rules.

Schemas contain no validators, callbacks, source code, regular expressions,
credentials, runtime references, or database details. Regular expressions and
format names are intentionally absent in version 1 because their validation
semantics vary across languages and libraries.
