# Semantic client contract v1

Normative vectors for [RFC 0018](../../rfc/0018-semantic-client-contract.md).
The family is required by the TypeScript/Python conformance gates.

- success.json pins build, metric-only, empty and narrowed signed contracts.
- identities.json pins canonical complete documents and both identity domains.
- rejections.json pins malformed descriptors, identity failures, safe messages
  and JSON Pointer paths, plus exact size/depth/count boundaries and text decoding.
- queries.json pins accepted strict HTTP/MCP input and complete normalized output.
- query-rejections.json pins invalid selections, types, nulls, operators and budgets.
- relations.json pins cross-view schema stability and query-target visibility.
- timezone-names.txt is the case-sensitive portable timezone registry. Runtime
  package registries must match it; aliases are retained verbatim in identities.

For compact review, cases can reference a success ID via base/contract/left/right.
The conformance runner composes these references before dispatching the case;
implementations receive complete inputs and need no fixture-file access. A set
array adds/replaces fields in a deep-copied base using RFC 6901 JSON Pointers;
- appends an array element. Parents must exist. It never recomputes identities:
malformed shape validation must precede identity validation. The runner's boundary
generators expand only synthetic byte, depth, endpoint, descriptor and array-member counts.
Identity cases reuse the matching success value, as other fixture families do.

The query compiler preserves fixed MCP tool names; empty target sets have required
never-valued routing fields. JSON Schema pins structural types; call-time semantic
validation additionally enforces selected fields, uniqueness, portable timezones
and combined predicate budgets. No artifact identity authenticates a principal or
certifies an endpoint's execution implementation.
