# Draft client-contract-v1 vectors

These JSON vectors accompany [Proposed RFC 0018](../../rfc/0018-semantic-client-contract.md).
They are **not** registered conformance cases and are not a supported wire version.
Do not announce this family or add it to manifest.json before RFC acceptance.

| File | Purpose |
| --- | --- |
| success.json | Four documents: build, metric-only authorized, empty, narrower limits |
| identities.json | Canonical complete documents, endpoint hashes and content hashes |
| rejections.json | Thirty malformed shape/reference/identity cases |
| queries.json | Thirty-six valid/invalid strict-profile request and MCP mapping cases |
| relations.json | Cross-view schema stability and metric-only query visibility |

Each success case has a unique id and a value. Rejections identify a success
case by base and carry the proposed error code. To keep review focused on the
invalid input, their set array applies replacements/additions to a deep copy of
that base via JSON Pointers (RFC 6901); a final - appends an array element. All
parent containers must exist; a set cannot remove a member. Apply entries in
order, then sort/hash as RFC 0018 specifies when rehash=true. When rehash=false,
retain the modified identities exactly. This materialization belongs in the
future fixture adapters, not a permissive runtime parser.

Structurally malformed cases therefore have recomputed hashes unless identity
itself is the intended failure: hash checking must not mask validation of an
unsafe descriptor. Hash materialization for a negative fixture does not imply
the document is otherwise valid. No malformed-case materializer is a protocol
validation implementation.

Query cases refer to a success case by contract and a registered endpoint id.
HTTP is the default transport. An MCP case explicitly declares transport=mcp
and its expected mapped http body. accept=false cases pin HQ_CLIENT_QUERY;
transport adapters map that safe internal validation failure to their own
HTTP/MCP envelope rather than echoing submitted data. This is not the legacy
Python request parser's full acceptance language: RFC 0018 defines an opt-in
strict client profile that needs endpoint enforcement in the implementation PRs.

The build fixture demonstrates numeric dimension wire ambiguity, nullable
related dimensions, a filter-only related field, a named filter alias, derived
and related selectable measures omitted from the defaults, a string-valued
aggregate that cannot be used in numeric HAVING, custom route prefixes and a
metric output alias different from its export ID. The metric-only document has
no direct dataset endpoint even though its metric belongs to the orders group.

Hashes use the existing RFC 8785 serializer, endpoint-schema/view domain prefixes
from RFC 0018, and one actual NUL byte after each prefix. Canonical bytes include
the contentHash field; the bytes **hashed** for contentHash exclude that field.
Endpoint hashing excludes limits/schemaHash, so lowering a page cap preserves
its schema identity but changes the view contentHash.

Remaining acceptance work includes failure paths/messages, hostile host-object
generators and a pinned empty MCP tool convention. Byte/depth/count boundary
generators belong in the accepted conformance family; these examples alone do
not satisfy those gates. Keep synthetic fixtures free of credentials/customer
data, and preserve their draft status while the format is reviewed.
