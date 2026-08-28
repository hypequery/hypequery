# Tagged value version 1 fixtures

These draft language-neutral fixtures accompany RFC 0001. They become
normative when the RFC is accepted.

## Success manifest

Each entry in `success.json` contains:

- `id`: stable fixture identifier;
- `value`: the parsed canonical value before JCS;
- `canonicalHex`: exact RFC 8785 canonical UTF-8 bytes as lowercase hex;
- `sha256`: lowercase SHA-256 of those exact bytes.

The hash is a fixture integrity check, not a deployment digest or cache key.

The success corpus includes every finite, non-negative-zero number from RFC
8785 Appendix B. RFC 0001 is intentionally stricter than JCS for negative zero,
NaN, and infinities, so those Appendix B cases live in the rejection corpus.

## Rejection manifest

Entries in `rejections.json` use one of:

- `sourceUtf8`: exact JSON source presented to a duplicate-aware parser;
- `value`: an already parsed value presented to model validation;
- `generator`: a deterministic boundary case that would be wasteful to store
  expanded.

`declaredClickHouseType`, when present, supplies the containing schema type
needed to validate integer-tag requirements and exact tag/type compatibility.

Generators expand as follows:

- `non-finite-float`: creates the host-language non-finite number named by
  `value` (`NaN`, `Infinity`, or `-Infinity`) after JSON parsing;
- `nested-array`: wraps `leaf` in the tagged array form `depth` times;
- `array`: creates one tagged array containing `items` copies of `value`;
- `array-tree`: creates one tagged array containing `branches` tagged arrays,
  each containing `itemsPerBranch` copies of `value`;
- `repeat-string`: concatenates `count` copies of the UTF-8 string `utf8`;
- `unsafe-accessor`: builds an object whose `$hypequery` member is served by a
  computed accessor rather than a plain data property. Implementations whose
  input model cannot express computed accessors respond `skipped`, and must
  then declare their own hostile-object suite per RFC 0012.

`error` is the required stable failure code. `phase` identifies the earliest
stage that must reject the input. A consumer may reject earlier only when it
returns the same code and does not partially execute or hash the value.

## What these fixtures cannot express

Metadata integers are accepted by value, not by lexical form: `1`, `1.0`, and
`1e0` all denote `1` and all canonicalize to `1`. The manifest cannot carry
that distinction — writing `1.0` into a `value` field serializes back to `1` —
so per-language unit tests cover the coercion of an integral host float.

Fixture runners must not pass `sourceUtf8` through an ordinary JSON dictionary
parser before duplicate-key detection.
