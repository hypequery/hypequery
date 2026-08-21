# RFC 0002: Portable logical identifiers

- Status: Accepted
- Accepted: 2026-07-30
- Version: identifier extension 1

Acceptance freezes identifier extension version 1. Changing the grammar,
comparison rules, reserved namespace, limits, or validation order now requires
a new extension version, not an edit.

## Summary

Portable Hypequery artifacts need stable names for projects, datasets, queries,
metrics, dimensions, measures, filters, parameters, and relationships. These
names must have the same interpretation in TypeScript, Python, Serve, and Cloud
and must not depend on SQL dialect quoting or Unicode normalization.

This RFC defines one simple identifier grammar and a qualified form composed of
identifier segments separated by `.`.

## Simple identifiers

A version 1 identifier MUST:

- be a JSON string;
- contain between 1 and 128 UTF-8 bytes;
- match `^[A-Za-z_][A-Za-z0-9_]*$`;
- be compared byte-for-byte and case-sensitively;
- not begin with `__hypequery`, using an ASCII case-insensitive comparison.

Implementations MUST preserve the original spelling. They MUST NOT trim,
case-fold, percent-decode, or apply Unicode normalization. Version 1 is ASCII
only, so visually equivalent Unicode spellings are rejected rather than
normalized.

The `__hypequery` prefix is reserved for protocol-defined names. A future core
version may define such names; applications cannot claim them in version 1. In
a qualified identifier the reservation applies to **every** segment, not only
the first: `orders.__hypequery_internal` is rejected.

## Validation order

Checks MUST be applied in this order, and the first failure determines the
reported code:

1. `HQ_IDENTIFIER_TYPE` — the input is not a JSON string.
2. `HQ_IDENTIFIER_EMPTY` — the input has zero length.
3. `HQ_IDENTIFIER_TOO_LONG` — a byte limit is exceeded.
4. `HQ_IDENTIFIER_INVALID_FORMAT` — the character grammar does not match.
5. `HQ_IDENTIFIER_RESERVED` — the reserved prefix is present.

The order is normative because more than one check can apply to the same input.
A 200-byte name beginning with `__hypequery` reports `HQ_IDENTIFIER_TOO_LONG`,
not `HQ_IDENTIFIER_RESERVED`. A 129-byte name containing a hyphen reports
`HQ_IDENTIFIER_TOO_LONG`, not `HQ_IDENTIFIER_INVALID_FORMAT`.

Step 4 preceding step 5 is a **security property**, not a preference. The
reserved-prefix comparison is ASCII case-insensitive; placing the grammar check
first guarantees it only ever sees ASCII. Case-folding rules for non-ASCII
input differ between host languages — the dotted and dotless `i` families are
the standard example — so a reserved check reached before the ASCII gate could
accept in one language and reject in another.

For qualified identifiers the checks apply first to the whole string (type,
emptiness, the 512-byte limit, then the segment count) and afterwards to each
segment in order. An empty segment inside a qualified identifier reports
`HQ_IDENTIFIER_INVALID_FORMAT` rather than `HQ_IDENTIFIER_EMPTY`, because the
qualified string itself is not empty.

## Qualified identifiers

A qualified identifier is between 1 and 8 simple identifier segments joined by
one literal `.` byte. Its complete UTF-8 representation MUST NOT exceed 512
bytes. Empty segments, leading or trailing dots, repeated dots, and alternate
separator encodings are invalid.

Examples:

```text
orders
orders.customer
orders.customer.country
```

Qualification expresses logical containment or traversal only. It is not a SQL
identifier, table path, filename, URL, or package export. Product adapters own
translation into those domains.

## Limits

| Limit | Maximum |
| --- | ---: |
| UTF-8 bytes in one segment | 128 |
| Segments in one qualified identifier | 8 |
| UTF-8 bytes in one qualified identifier | 512 |

Products may impose lower limits but cannot reinterpret accepted version 1
identifiers.

`HQ_IDENTIFIER_TOO_LONG` covers both the segment limit and the qualified limit.
A product that needs to tell a caller which bound was exceeded may add safe
detail alongside the code, but the code itself does not distinguish them.

Because version 1 is ASCII only, byte length and character count are always
equal. Implementations MUST still measure UTF-8 bytes, so that rejected
non-ASCII input is measured consistently.

## Stable failure codes

- `HQ_IDENTIFIER_TYPE`
- `HQ_IDENTIFIER_EMPTY`
- `HQ_IDENTIFIER_TOO_LONG`
- `HQ_IDENTIFIER_INVALID_FORMAT`
- `HQ_IDENTIFIER_RESERVED`
- `HQ_IDENTIFIER_TOO_MANY_SEGMENTS`

Errors and diagnostics MUST NOT include the rejected identifier unless the
calling product explicitly chooses a safe redacted presentation.

## Security considerations

- ASCII-only names avoid confusable and normalization disagreements at the
  portable artifact boundary.
- ASCII-only names also make canonical object-key ordering language-neutral.
  RFC 8785 sorts object properties by UTF-16 code unit; a code-point sort
  disagrees with that only above the basic multilingual plane. Restricting
  identifiers to ASCII means the two orderings coincide wherever an identifier
  could influence a key, so a canonicalizer cannot produce different bytes in
  different languages for the same model.
- The reserved namespace prevents user data from impersonating future protocol
  fields.
- Parsers validate limits before allocating derived structures.
- SQL quoting and filesystem sanitization remain mandatory in their respective
  adapters; passing this grammar does not make a name safe for another domain.

## Compatibility

Changing the grammar, comparison rules, reserved namespace, or limits requires
a new identifier extension or core protocol version. Package SemVer does not
select this version.
