# Tagged value v1 fixtures

These draft fixtures accompany RFC 0001 and pin canonical values before they become a stable wire contract.

- `success.json` contains parsed values, exact RFC 8785 UTF-8 bytes as hex, and SHA-256 integrity hashes.
- `rejections.json` contains exact JSON source, parsed values, or deterministic boundary generators with required error codes.

The hash here verifies fixture bytes; it is not a deployment or cache identity. Duplicate-key cases must reach a duplicate-aware parser before ordinary object decoding. Generated cases cover non-finite numbers, nested and wide arrays, repeated strings, and integer tag/type compatibility.
