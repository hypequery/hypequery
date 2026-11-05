# RFC 0018 amendment: negotiated field metadata — 5 November 2026

Status: proposed with its implementation PR. It amends the client-contract-v1
data format; it changes no hash domain and no existing identity vector.

## Context

The deployment contract already validates per-field synonyms, examples, format,
unit and currency, and the TypeScript local MCP server shows them to agents.
Client-contract annotations carried only label and description, so the Python
MCP server and the TypeScript HTTP bridge, which both serve agents from the
client contract, dropped that vocabulary. Agents then guess field names and
value spellings that the backend already knows.

The October amendment (decision 5 of
[0018-client-contract-annotations](./0018-client-contract-annotations.md)) relied
on no producer being published. That no longer holds: Python 0.1.0b1 and
`@hypequery/datasets`' `buildClientContract` produce annotations, and released
`@hypequery/protocol` validators (used by `@hypequery/mcp` and
`hypequery generate:client`) reject unknown field annotation members.

## Decision

1. **Five optional field members.** A fields entry may carry synonyms, examples,
   format, unit and currency beside label and description. Endpoint-level
   annotations do not; sensitivity and timezone stay unadvertised.
2. **Deployment bounds.** List members are non-empty, at most 100 distinct
   items, in producer order; every text value follows the existing annotation
   text rules; currency is three uppercase ASCII letters. These are the
   deployment contract's bounds, so any valid deployed vocabulary can be
   advertised. Producers fold whitespace, drop blank items and keep the first
   of repeated items; empty lists are omitted so "no metadata" has one encoding.
3. **Negotiated, not assumed.** A consumer names `field-metadata` in the
   `x-hypequery-client-features` discovery request header. Producers emit the
   members only to such a request and otherwise serve the reduced view an older
   validator accepts; responses vary on the header. A new artifact version was
   rejected: the members are presentation data outside schemaHash, and a
   version bump would break every released consumer instead of none.
4. **Offline exports stay compatible by default.** A build export has no request
   to negotiate with, so it omits field metadata unless its producer is asked
   (`field_metadata=True` in Python, `fieldMetadata: true` in
   `buildClientContract`). Producers still validate the vocabulary, so an
   invalid definition fails export either way.
5. **Identities.** Annotations remain outside schemaHash, so both views pin the
   same execution schema; they differ in contentHash, which identifies the view
   bytes. `withoutClientFieldMetadata` / `without_client_field_metadata` derive
   the reduced view from a full one.
6. **Consumers.** Both MCP servers ask for field metadata on discovery and return
   it with each endpoint profile from `get_dataset_schema`. generate:client keeps
   emitting label/description JSDoc only. Like other annotations, field metadata
   is untrusted presentation data: no consumer derives permissions, routing,
   validation or instructions from it.
7. **Later members.** The features header is the negotiation for future
   optional members: each gets its own token, and producers keep serving the
   reduced view to requests without it.

## Evidence

The client-contract-v1 family adds a `field-metadata` success/identity vector
(annotated plus metadata, including entries without label or description), a
relation proving it keeps every annotated schemaHash with a new contentHash, and
rejections for non-array, empty, non-string, blank, line-break, duplicate and
101-item lists (100 accepted), 4096/4097-byte items and format text, blank
format, non-string unit, C1 controls, lowercase, four-letter and numeric
currency, an unknown field member (`sensitivity`), field metadata on endpoint
annotations, and a reworded synonym failing contentHash. The previous
`annotation-unknown-field-entry-member` case moved from `unit`, now valid, to an
undefined member. Both the TypeScript reference and Python adapters pass the
family, and stripping the field-metadata vector reproduces the annotated vector
byte for byte in both languages.
