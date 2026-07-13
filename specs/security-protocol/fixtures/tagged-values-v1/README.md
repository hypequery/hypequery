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

## Rejection manifest

Entries in `rejections.json` use one of:

- `sourceUtf8`: exact JSON source presented to a duplicate-aware parser;
- `value`: an already parsed value presented to model validation;
- `generator`: a deterministic boundary case that would be wasteful to store
  expanded.

`error` is the required stable failure code. `phase` identifies the earliest
stage that must reject the input. A consumer may reject earlier only when it
returns the same code and does not partially execute or hash the value.

Fixture runners must not pass `sourceUtf8` through an ordinary JSON dictionary
parser before duplicate-key detection.
