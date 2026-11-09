# Client contract HTTP fixtures v1

`cases.json` runs against TypeScript `createAPI` and Python's `create_api`.
Both fixture apps author the dataset and metric in `app` the same way, serve them
under `basePath`, and are mounted at `mountPath`. `contract` is the build view
each must export, byte for byte: TypeScript's `api.clientContract()` and Python's
`export_client_contract(api)` ([RFC 0018](../../../security-protocol/rfc/0018-semantic-client-contract.md)).

Cases pin the `X-Hypequery-Client-Schema` precondition. `pin: "current"` sends
the endpoint's exported `schemaHash`. Any other value is sent verbatim. The cases
cover a matching pin (strict client profile, default measures, public metadata
only), a stale pin (409 `VALIDATION_ERROR`, `details.code` `CLIENT_SCHEMA_CHANGED`,
checked before body validation), a pinned body outside the client profile (400
with the validator's pointer), and authentication taking precedence over drift.

An unpinned request is the one behaviour the languages may differ on outside
these cases. Python's opted-in endpoints always apply the strict profile, while
TypeScript applies it only to pinned requests and otherwise serves its wider
legacy input. The shared case uses a body both accept.

`pnpm conformance:serve` runs this suite in both languages.
