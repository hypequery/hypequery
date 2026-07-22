# Deployment contract v1 fixtures

- `success.json` contains complete contracts accepted by the v1 validator.
- `rejections.json` maps generated invalid inputs to stable failure codes.
- `identity.json` fixes the RFC 8785 canonical bytes and domain-separated
  SHA-256 identity for matching success fixture ids.

These fixtures exercise RFC 0006 deployment envelopes. `success.json`
contains language-neutral accepted values. `rejections.json` identifies
deterministic generated inputs and the stable error code every conforming
implementation must return.

## Generated rejection semantics

Every rejection is a deterministic transform of this pinned base deployment
(RFC 0012), where `dataset(name)` denotes:

```json
{
  "name": "<name>",
  "source": "orders",
  "tenant": { "kind": "not-required" },
  "dimensions": [],
  "measures": [],
  "filters": [],
  "metrics": [],
  "relationships": []
}
```

and the base is:

```json
{
  "kind": "hypequery-deployment",
  "version": 1,
  "datasets": [dataset("orders")],
  "queries": [],
  "artifacts": []
}
```

Generator types expand as follows:

- `wrong-root-type`: an empty array instead of an object;
- `unknown-root-field`: the base plus `"extra": true`;
- `unsupported-version`: the base with `"version": 2`;
- `invalid-dataset-identifier`: the base with its only dataset replaced by
  `dataset("bad-name")` (hyphens are not valid identifier characters);
- `invalid-relationship-queryability`: the base with its only dataset given
  one relationship
  `{ "name": "items", "kind": "hasMany", "target": "orders", "from": "id",
  "to": "order_id", "queryable": true }` (a `hasMany` relationship must not
  be queryable);
- `missing-runtime-artifact`: the base plus one named query `health` with
  input `{ "kind": "any" }`, output `{ "kind": "any" }`, implementation
  `{ "kind": "runtime-reference", "runtime": "node", "artifactSha256":
  <64 zeros>, "entrypoint": "queries.health" }`, endpoint
  `{ "access": { "kind": "public" }, "tenant": { "kind": "not-required" },
  "method": "GET", "path": "/health" }`, and `"tags": []` — while
  `artifacts` stays empty, so the referenced artifact does not exist;
- `ambiguous-query-route`: the base plus two named queries `first` and
  `second`, each with input `{ "kind": "void" }`, output
  `{ "kind": "void" }`, implementation `{ "kind": "semantic-plan",
  "query": { "kind": "dataset", "dataset": "orders", "dimensions": [],
  "measures": [], "filters": [], "orderBy": [] } }`, endpoint
  `{ "access": { "kind": "public" }, "tenant": { "kind": "not-required" },
  "method": "GET", "path": "/same" }`, and `"tags": []` — both share one
  method and path;
- `too-many-datasets`: the base with 101 datasets `dataset("dataset_0")`
  through `dataset("dataset_100")`;
- `source-too-large`: the base with its only dataset's `source` replaced by
  1025 repetitions of `a`;
- `unsafe-accessor`: the base with `kind` served by an enumerable computed
  accessor returning `"hypequery-deployment"` instead of a plain data
  property. Host-model conditional (RFC 0012): implementations whose input
  model cannot express computed accessors skip this case.
