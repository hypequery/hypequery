---
"@hypequery/protocol": minor
"@hypequery/datasets": minor
"@hypequery/mcp": minor
"@hypequery/cli": patch
---

Client contracts can carry field metadata: a field's annotations may now include `synonyms`, `examples`, `format`, `unit` and `currency` (RFC 0018 amendment, 5 November 2026), the same vocabulary the deployment contract already validates. The MCP HTTP bridge returns it with each endpoint profile from `get_dataset_schema`, so agents served from a Python backend or Cloud see the synonyms, example values and units that local mode already shows.

Field metadata is negotiated so released consumers keep working. Validators before this release reject the new members, so producers emit them only to a discovery request whose `x-hypequery-client-features` header names `field-metadata`; the MCP bridge sends it. `@hypequery/protocol` adds `CLIENT_CONTRACT_FEATURES_HEADER`, `acceptsClientFieldMetadata`, `parseClientContractFeatures` and `withoutClientFieldMetadata` (the reduced view for consumers that did not ask), and the `ClientAnnotationText` type. `buildClientContract` gains `fieldMetadata` (off by default): a Cloud or host discovery route sets it from the request header. Both views share every `schemaHash`, so neither invalidates generated clients or connected bridges.

Upgrade `@hypequery/protocol`, `@hypequery/mcp` and `@hypequery/cli` together with the producer you pair them with; a producer that only sends field metadata on request is safe with older consumers either way.
