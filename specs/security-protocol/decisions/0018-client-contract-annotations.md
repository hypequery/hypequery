# RFC 0018 amendment: endpoint annotations — 27 October 2026

Status: proposed with its implementation PR. It amends the client-contract-v1
data format; it changes no hash domain and no existing vector.

## Context

The MCP HTTP bridge lists dataset groups from the authorized client contract.
Version 1 deliberately carried no labels or descriptions, so every group was
listed as "Authorized client endpoints." and an agent had to fetch each schema
to tell groups apart. TypeScript datasets and Python dimensions/measures already
carry a label and description (Python datasets gain them with this change), and
the deployment contract already publishes them under bounded text rules.

## Decision

1. **One optional endpoint member.** annotations holds optional label and
   description for the endpoint's dataset group and an optional fields record of
   per-dimension/measure label and description. Keeping all text in one sibling
   member, instead of on each descriptor, leaves every descriptor shape closed
   and unchanged and makes the identity rule a single removal.
2. **Excluded from schemaHash, included in contentHash.** schemaHash is the
   execution precondition (X-Hypequery-Client-Schema) and the frontend
   compatibility key. Rewording a description must not 409 a connected bridge or
   invalidate generated clients, so annotations are removed with limits before
   hashing. contentHash still identifies the exact view bytes. An endpoint
   without annotations keeps its existing schemaHash, and the four existing
   canonical documents keep their bytes and hashes; this is why no new hash
   domain or artifact version is required.
3. **Deployment text rules.** Non-blank, no C0/DEL/C1 controls, at most 4096
   UTF-8 bytes; identical to the deployment contract's label/description so any
   deployed text can be advertised. Producers fold whitespace runs (multi-line
   definitions become one line) and omit empty text. Empty objects/records are
   invalid so "no annotation" has one canonical encoding.
4. **Group-level text on every endpoint.** Endpoint label/description describe
   the dataset group, so a metric-only authorized view still describes it. A
   metric describes itself through its sole measure's fields entry.
5. **No negotiation.** Consumers released before this amendment reject the new
   member. Python is the only producer of this artifact and has not been
   published, so no released producer/consumer pair breaks: producers emit
   annotations whenever a definition has text. Once a producer is released, a
   further member addition needs explicit negotiation or a new version.
6. **Consumers.** The MCP bridge lists each group's own description (falling back
   to the generic text) and returns annotations with each endpoint profile.
   generate:client emits them as JSDoc on the ClientApi entry and on output row
   fields, escaping comment terminators. Annotations are presentation data: no
   consumer derives permissions, routing or validation from them.

## Evidence

The client-contract-v1 family adds an annotated build success/identity vector, a
relation proving annotations leave every endpoint schemaHash unchanged while
changing contentHash, and rejections for unknown/empty members, blank and
control-character text, byte-exact 4096/4097 bounds (multi-byte, so bytes are
counted rather than characters) and unknown field references. Both the
TypeScript reference and Python adapters pass the family.
