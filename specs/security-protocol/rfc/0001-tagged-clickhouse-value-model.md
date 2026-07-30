# RFC 0001: Tagged ClickHouse value model

- Status: Accepted
- Created: 2026-07-13
- Accepted: 2026-07-30
- Target extension version: 1
- Owners: Hypequery maintainers

Acceptance freezes extension version 1. Changing a rule below now requires a
new extension version, not an edit.

## Summary

Hypequery canonical artifacts use RFC 8785 JSON Canonicalization Scheme (JCS)
without modification. Values that cannot be represented safely and
unambiguously by interoperable JSON use strict, versioned Hypequery tags before
JCS is applied.

This RFC defines the value layer only. Parameter names, complete ClickHouse
type expressions, sensitivity classes, bundle envelopes, query digest domains,
and cache-key derivation are defined by later contracts. Those contracts pair a
canonical value with its declared logical and ClickHouse types and must reject a
mismatch.

## Goals

- Produce byte-identical canonical values in TypeScript and Python.
- Preserve integer, decimal, temporal, UUID, byte, enum, and composite meaning
  without host-language conversion rules.
- Reject ambiguous, lossy, oversized, or executable input before hashing or
  query compilation.
- Keep the representation public and independently implementable.

## Non-goals

- Changing or extending the JCS algorithm.
- Parsing arbitrary ClickHouse type strings or SQL.
- Defining driver wire encodings.
- Supporting every ClickHouse data type in version 1.
- Serializing callbacks, classes, proxies, custom objects, or host-language
  objects through methods such as `toJSON`.

## Terminology

- **Parsed value:** a duplicate-aware I-JSON parse result before Hypequery
  model validation.
- **Canonical value:** a parsed value that satisfies this RFC.
- **Tagged value:** an object with exactly one `$hypequery` member whose value
  is a strict tag payload.
- **Canonical bytes:** UTF-8 bytes emitted by RFC 8785 over a canonical value.
- **Value hash:** lowercase hexadecimal SHA-256 of canonical bytes. Fixture
  value hashes are conformance aids, not deployment digests or cache keys.

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, and MAY are to be
interpreted as described by BCP 14.

## Processing order

An implementation MUST perform these stages in order:

1. Enforce the encoded-byte limit while reading input.
2. Parse JSON while detecting duplicate object keys at every depth.
3. Validate I-JSON strings and numbers without invoking custom serializers.
4. Validate the native or tagged Hypequery value, including exact fields,
   ranges, collection limits, and declared type compatibility.
5. Apply RFC 8785 JCS without modifying strings or the value tree.
6. Encode the JCS result as UTF-8.
7. Hash the canonical bytes only in the domain defined by the containing
   artifact contract.

Rejecting duplicate keys after an ordinary dictionary parse is non-conformant
because the parser may already have discarded one of the values.

## Native I-JSON values

The following values use native JSON representations:

- `null` for the logical null value;
- `true` and `false` for booleans;
- JSON strings for Unicode text;
- JSON numbers for finite binary floating-point values only.

Strings MUST contain valid Unicode scalar values and MUST be preserved without
Unicode normalization.

Tab U+0009, line feed U+000A, and carriage return U+000D are permitted, so that
descriptions and other authored prose may span lines. Every other C0 control
character in U+0000 through U+001F, DEL U+007F, and every C1 control character
in U+0080 through U+009F are forbidden. JCS escapes the three permitted
controls deterministically, so canonical bytes remain unambiguous.

Quotes, backslashes, comment-looking text, and other ordinary Unicode remain
data.

Native JSON numbers are floating-point values. NaN, positive or negative
Infinity, and lexical negative zero are forbidden. An integer-valued JSON token
does not become an integer: integer semantics require the integer tag below.
The declared containing type decides whether a finite native number is
`Float32` or `Float64` and validates any additional range or rounding policy.

Strict tag metadata such as `version`, `bits`, `precision`, `scale`, and enum
`code` uses bounded native JSON integers because each field's integer meaning
and range are fixed by its tag schema. The integer-tag requirement applies to
semantic values, not to these closed-schema metadata fields.

These metadata fields are defined **by value, not by lexical form**. A metadata
integer MUST be a finite number that is mathematically integral, is not
negative zero, lies within the interoperable safe-integer range, and satisfies
its field's own range. `1`, `1.0`, and `1e0` all denote the integer `1` and are
all accepted; each canonicalizes to `1`, so they are indistinguishable in
canonical bytes. `1.5` is rejected with `HQ_VALUE_INVALID_FORMAT`.

Lexical rejection is deliberately **not** required. JavaScript erases the
distinction between `1` and `1.0` at parse time, so a rule keyed on lexical
form could only be honoured by one language on the programmatic entry path:
an implementation handed an already-constructed host value would accept `1.0`
in JavaScript and reject it in Python, for the same logical input. Because
every accepted spelling produces identical canonical bytes, the strictness
would create a cross-language divergence without preventing any confusion,
downgrade, or hash collision. Implementations MUST therefore coerce an
integral host float to its integer value rather than rejecting it.

### Number serialization is the ECMAScript algorithm

RFC 8785 serializes numbers using the ECMAScript `Number::toString` algorithm.
This is not equivalent to a host language's default float formatting, and the
difference is silent rather than loud:

| Value | Python `json.dumps` | Required by JCS |
| --- | --- | --- |
| `1e20` | `1e+20` | `100000000000000000000` |
| `1e-7` | `1e-07` | `1e-7` |
| `1e-6` | `1e-06` | `0.000001` |
| `100.0` | `100.0` | `100` |

A JavaScript implementation inherits the correct behaviour from
`JSON.stringify`. Every other implementation MUST implement shortest
round-trip formatting with ECMAScript's exponent thresholds and notation
explicitly, and MUST NOT delegate to a host `repr`, `str`, or default JSON
encoder. Conformance fixtures cover the boundaries where host formatting is
known to diverge.

Raw JSON arrays and application-created objects are not canonical values. They
must be represented by the array, tuple, or map tags. Objects belonging to the
containing artifact schema are outside this value union and are validated by
that schema.

## Tag envelope

A tagged value has this shape:

```json
{
  "$hypequery": {
    "type": "integer",
    "version": 1
  }
}
```

The outer object MUST contain exactly `$hypequery`. The payload MUST contain
exactly the fields defined for its tag. Unknown fields, unknown types, and
unknown versions fail closed. Version 1 payloads use the integer JSON number
`1`; a string or floating representation is invalid.

The tag is a data-model extension, not a JCS extension. It is validated into an
ordinary I-JSON tree and then canonicalized normally.

## Version 1 tag registry

### Integer

```json
{
  "$hypequery": {
    "bits": 64,
    "signed": false,
    "type": "integer",
    "value": "18446744073709551615",
    "version": 1
  }
}
```

- `bits` MUST be one of `8`, `16`, `32`, `64`, `128`, or `256`.
- `signed` MUST be a JSON boolean.
- `value` MUST be canonical base-10: `0` or an optional `-` followed by a
  non-zero digit and remaining digits.
- `+`, leading zeroes, whitespace, exponents, decimal points, and `-0` are
  forbidden.
- The value MUST fit the signed or unsigned range for `bits`.
- The containing ClickHouse type MUST be the corresponding `IntN` or `UIntN`.

All integers use this tag, including integers within the I-JSON safe range.
This prevents a security-sensitive integer from being confused with a binary
floating-point number.

### Decimal

```json
{
  "$hypequery": {
    "coefficient": "-123450",
    "precision": 18,
    "scale": 4,
    "type": "decimal",
    "version": 1
  }
}
```

The represented value is `coefficient × 10^-scale`.

- `precision` MUST be an integer from `1` through `76`.
- `scale` MUST be an integer from `0` through `precision`.
- `coefficient` follows the canonical integer string rules, including no
  negative zero.
- The coefficient MUST contain no more than `precision` decimal digits,
  excluding its sign.
- The tag never accepts a binary float as a decimal source.
- The containing Decimal type MUST have the same precision and scale. Alias
  forms such as `Decimal64(S)` are normalized by the later type contract before
  comparison.

Trailing fractional zeroes are preserved through the coefficient and declared
scale. For example Decimal(9, 4) value `12.3400` has coefficient `123400`.

### Date

```json
{
  "$hypequery": {
    "clickhouseType": "Date",
    "type": "date",
    "value": "2026-07-13",
    "version": 1
  }
}
```

- `clickhouseType` MUST be `Date` or `Date32`.
- `value` MUST be a real proleptic-Gregorian date in `YYYY-MM-DD` form.
- `Date` values MUST be within `1970-01-01` through `2149-06-06`.
- `Date32` values MUST be within `1900-01-01` through `2299-12-31`.
- Host locale and timezone do not participate in parsing.

### Datetime

```json
{
  "$hypequery": {
    "clickhouseType": "DateTime64",
    "precision": 3,
    "timezone": "Europe/Madrid",
    "type": "datetime",
    "value": "2026-07-13T14:30:45.123Z",
    "version": 1
  }
}
```

- `clickhouseType` MUST be `DateTime` or `DateTime64`.
- `precision` MUST be `0` for `DateTime` and an integer from `0` through `9`
  for `DateTime64`.
- `timezone` MUST be an explicit **timezone identifier** supplied by the
  containing schema. Offset labels such as `+02:00` and local-process defaults
  are forbidden. The value layer does not assert that the identifier names a
  real zone; it asserts only that the identifier is syntactically safe and
  exactly equal to the one the containing type declares.
- Validation is lexical: one or more `/`-separated components, each matching
  `[A-Za-z0-9_+-]+`, with the first component beginning with an ASCII letter,
  at most 64 bytes in total, no empty component, no leading or trailing `/`,
  and no component equal to `.` or `..`. Single-component identifiers are
  valid, because `UTC`, `EST`, `GMT`, `CET`, `MST7MDT`, and `W-SU` are all
  real tzdb entries. Requiring a leading letter rejects offset-shaped input
  such as `+0200` while still admitting `Etc/GMT+5`.
- Implementations MUST NOT require the identifier to resolve in the host
  timezone database. Python `zoneinfo` and JavaScript ICU disagree about
  renamed zones such as `Europe/Kiev` versus `Europe/Kyiv`, and tzdb naming
  is explicitly documented as evolving, so a host-resolved check would make
  conformance depend on the OS image rather than the protocol.
- Existence is a **deployment-time** concern, not a value-layer one. The
  deployment contract validates the identifier against the target server's
  `system.time_zones`, which is the set ClickHouse actually supports.
- `value` MUST be an RFC 3339 UTC instant ending in uppercase `Z`.
- The fractional part MUST be absent at precision `0` and contain exactly
  `precision` digits otherwise. Inputs with offsets are normalized to this UTC
  form before the tag is constructed.
- The instant MUST fit the **portable v1 range** for the declared type and
  precision:
  - `DateTime`: `1970-01-01T00:00:00Z` through `2106-02-07T06:28:15Z`.
  - `DateTime64(P)` for `P` in `0`–`8`: `1900-01-01T00:00:00Z` through
    `2299-12-31T23:59:59Z` plus `P` fractional nines.
  - `DateTime64(9)`: `1900-01-01T00:00:00Z` through
    `2262-04-11T23:47:16.854775807Z`, the largest instant representable as a
    signed 64-bit count of nanosecond ticks since `1970-01-01T00:00:00Z`.

  This is deliberately a **conservative subset**, not a restatement of
  ClickHouse's own limits. ClickHouse documents a wider range at some
  precisions and a narrower one at others, and those limits have moved between
  releases. Freezing a subset that is valid across the supported server range
  keeps artifact identity stable when a server upgrade changes the underlying
  type. Implementations MUST use these exact bounds rather than deriving their
  own or querying the server.

The timezone is type policy and display/parse context; the canonical `value`
identifies the instant. No implementation may infer a missing timezone.

### UUID

```json
{
  "$hypequery": {
    "type": "uuid",
    "value": "01890f3e-7b7b-7cc2-98c4-dc0c0c07398f",
    "version": 1
  }
}
```

The value MUST use lowercase hexadecimal canonical UUID text with the
`8-4-4-4-12` grouping. Braces, uppercase, missing hyphens, and host-specific
UUID string forms are forbidden. All UUID versions are representable; version
policy belongs to the containing schema.

### Bytes

```json
{
  "$hypequery": {
    "encoding": "base64url",
    "type": "bytes",
    "value": "AP8Q",
    "version": 1
  }
}
```

Bytes use RFC 4648 base64url without `=` padding. The empty byte string is the
empty JSON string. Standard base64 characters `+` and `/`, whitespace,
non-minimal encodings, and padding are forbidden. The containing type decides
whether the bytes target `String`, `FixedString(N)`, or another allowed type and
validates its length.

### Enum

```json
{
  "$hypequery": {
    "bits": 8,
    "code": -1,
    "label": "unknown",
    "type": "enum",
    "version": 1
  }
}
```

- `bits` MUST be `8` or `16`.
- `code` MUST be a native JSON integer in the corresponding signed range.
- `label` follows the native string rules.
- Both label and code MUST match one member of the declared `Enum8` or `Enum16`
  type. Carrying both makes an enum-definition drift observable.

### Array

```json
{
  "$hypequery": {
    "type": "array",
    "values": [true, false, null],
    "version": 1
  }
}
```

`values` is an ordered JSON array of canonical values. Order is semantic and is
never sorted. The containing `Array(T)` type validates element compatibility.

### Tuple

```json
{
  "$hypequery": {
    "type": "tuple",
    "values": ["EMEA", true],
    "version": 1
  }
}
```

`values` is an ordered JSON array of canonical values. Positional and named
tuple type declarations are outside the value and MUST match its arity and
members.

### Map

```json
{
  "$hypequery": {
    "entries": [
      ["region", "EMEA"],
      ["region", "fallback"]
    ],
    "type": "map",
    "version": 1
  }
}
```

`entries` is an ordered array of two-element `[key, value]` arrays. Order is
semantic and duplicate map keys are preserved because ClickHouse Map is
represented as `Array(Tuple(K, V))` and permits duplicate keys. This does not
relax the prohibition on duplicate JSON object property names. The containing
`Map(K, V)` type validates both members of every entry.

## Absolute version 1 limits

These limits apply before product-specific policy. A product MAY advertise a
lower limit but MUST NOT accept a larger value under extension version 1.

| Limit | Maximum |
| --- | ---: |
| Encoded input for one canonical value | 1,048,576 bytes |
| Canonical UTF-8 for one canonical value | 1,048,576 bytes |
| Tagged composite nesting depth | 16 |
| Total value nodes | 10,000 |
| Values in one array or tuple | 1,000 |
| Entries in one map | 1,000 |
| UTF-8 bytes in one string or enum label | 65,536 |
| Decoded bytes in one bytes value | 65,536 |
| Decimal precision | 76 |

Depth is `0` for a native scalar or scalar tag. Entering an array, tuple, or map
tag adds one. A map entry's two-element `[key, value]` array is structural and
does not add a further level: both members are traversed at the map's own depth.

Node count includes every scalar, every scalar tag, every composite tag, and
every map key and map value. The `values` and `entries` arrays are structural
and are not counted separately from the tag that owns them.

Implementations MUST check limits during parsing/validation rather than first
allocating an unbounded host-language object.

The encoded-input limit applies only when the implementation is given bytes or
text. When an already-parsed host value is supplied that stage is skipped, and
the canonical-output limit becomes the binding size constraint. Every other
limit applies to both entry points.

## Stable failure codes

Version 1 conformance fixtures use these minimum codes:

- `HQ_VALUE_INVALID_JSON`
- `HQ_VALUE_DUPLICATE_KEY`
- `HQ_VALUE_INVALID_UNICODE`
- `HQ_VALUE_CONTROL_CHARACTER`
- `HQ_VALUE_NON_FINITE_FLOAT`
- `HQ_VALUE_NEGATIVE_ZERO`
- `HQ_VALUE_INTEGER_TAG_REQUIRED`
- `HQ_VALUE_RAW_COMPOSITE`
- `HQ_VALUE_UNKNOWN_TAG`
- `HQ_VALUE_UNKNOWN_TAG_VERSION`
- `HQ_VALUE_UNKNOWN_FIELD`
- `HQ_VALUE_INVALID_FORMAT`
- `HQ_VALUE_OUT_OF_RANGE`
- `HQ_VALUE_TYPE_MISMATCH`
- `HQ_VALUE_TOO_DEEP`
- `HQ_VALUE_TOO_MANY_NODES`
- `HQ_VALUE_TOO_MANY_ITEMS`
- `HQ_VALUE_TOO_LARGE`
- `HQ_VALUE_UNSAFE_OBJECT`

Products may attach safe source locations and expected types, but these codes
and their meaning are part of the frozen value contract.

`HQ_VALUE_UNSAFE_OBJECT` guards against host-language objects — getters,
proxies, `toJSON`, `__str__`, `__getattr__`, descriptors, and comparable
conversion hooks — none of which survive a JSON encoding. It is proven in two
layers:

1. The shared `unsafe-accessor` generator in the tagged-values rejection
   manifest, which every implementation translates into a representative host
   object. This is the same mechanism the expression, schema, event,
   deployment, bundle, and release families already use.
2. A language-specific suite covering the conversion mechanisms the shared
   generator cannot describe. TypeScript covers at least getters, `toJSON`,
   custom prototypes, symbol keys, and sparse arrays; Python covers at least
   property descriptors, custom mappings, `__iter__`, `__str__`, `dict`
   subclasses, and cyclic structures.

RFC 0012 defines the generator and requires the language-specific suite to be
declared. An implementation that skips the shared cases without declaring its
own suite is incomplete, not passing.

## Security considerations

- Validation must inspect plain data and must not invoke getters, proxies,
  `toJSON`, Python dunder conversion, or custom serializers.
- Number formatting is a correctness boundary, not a cosmetic one. An
  implementation that delegates float serialization to its host language will
  produce different canonical bytes, and therefore different artifact
  identities, for values that round-trip identically. This fails open: the
  values compare equal in memory while the hashes disagree.
- A rendered/debug representation is never executable SQL.
- Unknown tags and fields fail closed to prevent downgrade-by-interpretation.
- Duplicate-key detection occurs before normal object construction.
- Limits are enforced before hashing and before driver conversion.
- Canonical bytes may contain sensitive values and must not be logged. Raw
  SHA-256 value hashes are not suitable shared cache keys; the cache contract
  uses domain-separated HMAC with a project/environment secret.

## Compatibility

Changing a tag's fields, accepted lexical forms, meaning, limits, or canonical
preimage requires a new extension/core protocol version. Adding a new tag also
requires an explicit version compatibility decision; version 1 consumers do
not ignore unknown tags.

Package SemVer does not select this extension version. Containing artifacts
carry their protocol and schema versions explicitly.

## References

- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
- [RFC 7493: The I-JSON Message Format](https://www.rfc-editor.org/rfc/rfc7493)
- [RFC 3339: Date and Time on the Internet](https://www.rfc-editor.org/rfc/rfc3339)
- [RFC 4648: Base-N Encodings](https://www.rfc-editor.org/rfc/rfc4648)
- [ClickHouse Date](https://clickhouse.com/docs/sql-reference/data-types/date)
- [ClickHouse Date32](https://clickhouse.com/docs/sql-reference/data-types/date32)
- [ClickHouse DateTime](https://clickhouse.com/docs/sql-reference/data-types/datetime)
- [ClickHouse DateTime64](https://clickhouse.com/docs/sql-reference/data-types/datetime64)
- [ClickHouse Decimal](https://clickhouse.com/docs/sql-reference/data-types/decimal)
- [ClickHouse Map](https://clickhouse.com/docs/sql-reference/data-types/map)
