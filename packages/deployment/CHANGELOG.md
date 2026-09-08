# @hypequery/deployment

## 0.8.0

### Minor Changes

- bab2476: Add `projectAuthorizedDeploymentContract()`, which narrows a deployment contract
  to what one principal may see, plus the `satisfiesDeploymentAccess()` and
  `isDeploymentEndpointAuthorized()` predicates it is built from.

  It returns `{ contract, advertised, queryable }`, which are three different
  things and all three are needed. `contract` is the narrowed contract, still
  holding any dataset retained only to support a join or a named query.
  `advertised` is what belongs in the catalog. `queryable` is what may be named as
  a `query_dataset` target.

  `advertised` is narrower than `contract.datasets` because
  `projectAgentSafeCatalog` and `rehydrateProtocolDatasets` enumerate every
  dataset they are handed and neither consults an endpoint, so advertising the
  whole contract would disclose a supporting dataset's dimensions and measures to
  a principal with no access to it. `queryable` is narrower than `advertised`
  because a deployment authorizes a dataset and each of its metrics through
  separate endpoint policies: a principal can hold a metric on a dataset it may
  not query directly, and collapsing the two would either offer a target execution
  refuses or hide a metric it would run.

  A dataset reached only through its own metrics is also narrowed to what those
  metrics expose — their declared dimensions and filters, the measures their
  expressions can bind to, and the time field the planner needs. Execution already
  confines a metric call to that surface, so advertising the containing dataset
  whole would describe fields the caller was never granted. A dataset that something the principal can query joins to, across one queryable
  hop, keeps its _dimensions_, because a join carries exactly those — each groupable one as `<relationship>.<name>`, each
  filterable one under the full operator set — so they are genuinely reachable and
  dropping one would both invalidate a metric declaring it across the join and
  advertise less than execution accepts. Its measures and declared filters narrow
  like any other, because a join never made them reachable. How much reach depends on the route: a directly
  queryable dataset grants all of a target's dimensions, while a dataset the
  principal holds only a metric on grants only the qualified dimensions that
  metric declares, because `narrowToMetric` confines the call to those. Reach does
  not compound either — `resolveDataset` does not recurse, so a second-hop dataset
  stays in the contract for the chain to validate and is stripped like any other
  unreachable one, and a relationship that is not queryable carries no reach at
  all.

  Rehydrate `contract` so relationship targets still resolve, then pass
  `advertised` as the registry and `queryable` as `queryableDatasets`.

  Discovery and execution have to agree about who may reach what. The semantic
  data plane already decides that per call from the endpoint policy on the target;
  a gateway listing tools has to make the same decision across the whole contract,
  before any call exists. Restating the rule there would put an authorization
  predicate in two packages, and the copy that drifts is the one that leaks.

  The projection narrows and never widens, so feeding the result to catalog
  projection, schema compilation, or rehydration cannot advertise something
  execution would refuse. A metric is filtered on its own endpoint rather than its
  dataset's, because that is what the data plane resolves it against — a metric
  can be reachable on a dataset the principal cannot address, and unreachable on
  one it can.

  A dataset needed to keep the result coherent — the target of a relationship, or
  the dataset a retained named query plans over — is kept without its endpoint or
  metrics rather than dropped. Dropping it would invalidate any metric declaring a
  dimension across that relationship, and would advertise less than the data plane
  permits, since a one-hop join is governed by the endpoint of the dataset being
  queried rather than the target's. That is deliberate and it is what the data
  plane already permits: a supporting dataset's fields stay reachable as
  `<relationship>.<field>` on the dataset that joins to it, and hiding them would
  advertise less than execution accepts. What the split prevents is the target
  being offered as a target. An absent endpoint is read as unreachable rather than
  unguarded, and the contract is revalidated before it is returned.

- b0911ce: Add portable native execution of a semantic invocation (decision 0005).

  `createPortableSemanticExecutor()` in `@hypequery/datasets` resolves a dataset
  or metric from the validated active contract, rebuilds its catalog, and plans
  the query with the existing semantic planner. No customer module is loaded and
  no isolated runtime is required, so a bundle answers dataset and metric calls
  without a separately loaded MCP config. It applies the resolved tenant,
  propagates deadlines and cancellation to the database request, and byte-limits
  the result. A request the deadline aborts is reported as the budget it overran
  rather than as the driver's generic failure, so a caller can tell a query that
  ran out of time — worth retrying with less — from a broken or unreachable one.

  A resolved tenant that the rebuilt dataset has no field to scope by is refused
  before a query is built. That is the one failure that is otherwise silent: the
  runtime accepts the tenant, the planner emits no predicate, and the query reads
  every tenant while each layer believes tenancy was enforced. Contract validation
  already refuses to publish that shape, but the executor is exported on its own
  and typed structurally, so it cannot assume a caller went through the validator.

  A target portable execution cannot reproduce fails closed with
  `unsupported-capability` rather than being approximated — a derived metric,
  whose symbolic expression contract v1 does not carry until `CORE-17`. A single
  such metric no longer makes the rest of a deployment unexecutable:
  `rehydrateProtocolDatasets` gains `onUnsupportedMetric: 'skip'`, and the
  requested target is refused at the point of use instead.

  The deployment data plane now honours a failure category an injected executor
  claims for itself, from a fixed allow-list, so a capability gap is reported as
  one rather than as a broken query. A claim is granted by an explicit marker on
  the error rather than by its shape: a provider or library exception that happens
  to carry a generic `category` — a `not-found` from an HTTP client, say — cannot
  put its own message in front of a caller or decide whether the call is retried.
  An executor that claims nothing, that claims a category it may not (such as
  `forbidden`), or that never opted in, still reports `executor-failed` with the
  generic message. `PortableExecutionTenantError` joins the exported unsupported
  and budget errors that carry the marker.

  Deadline expiry and caller cancellation now settle execution independently of
  adapter cooperation while also aborting the underlying request. An adapter
  that ignores cancellation cannot return a successful response after the deadline
  or keep the invocation pending indefinitely.

- 8088e71: Add `createDeploymentSemanticDataPlane()`, semantic invocation beside
  named-query execution. A dataset or metric call now runs the same enforcement
  sequence a named query does: select the active generation, resolve the target
  and its endpoint policy from the validated contract, authenticate, enforce roles
  and scopes, resolve tenant, apply the most restrictive budget, validate the
  operation, execute, then validate the result.

  Execution is injected — this decides whether a call is allowed and what it may
  ask for, not how it runs. The bounds it computed are enforced against what the
  executor returned, so an executor cannot widen them: a result over the effective
  row or response-byte budget, one carrying more rows than the caller's own
  `limit` asked for, or one serving a different activation than the one selected,
  is refused rather than returned. Failures carry the portable
  `ProtocolSemanticInvocationFailure` categories, and
  `toProtocolSemanticInvocationFailure()` projects one onto the closed record
  without unwrapping a cause into it.

  Every ceiling a dataset declared binds, not only the `maxResultSize` that
  reaches the row budget: `maxDimensions`, `maxMeasures`, and `maxFilters` are
  published in the contract so a gateway can apply them, and each now tightens the
  corresponding server default rather than being dropped.

  Operation validation is contract-driven, so a gateway can reject a bad
  invocation without loading any of the deploying application's code:
  non-groupable dimensions, undeclared measures, filters outside a field's
  declared operator list, filters whose compared value is anything but a literal,
  unsupported grains, over-budget limits, and relationship paths deeper than one
  hop are all refused. Checking both operands of a comparison matters twice over:
  a right-hand reference addresses a field this layer never matched against the
  contract, and leaving it to the executor reports a caller's mistake as a
  deployment capability gap. A joined field carries
  its target's `groupable` and `filterable` flags separately, so a relationship
  neither hides a filterable field that cannot be grouped nor exposes one the
  target declared unfilterable.

### Patch Changes

- Updated dependencies [f639bd4]
- Updated dependencies [0ba2fa6]
  - @hypequery/protocol@0.13.0

## 0.7.5

### Patch Changes

- Updated dependencies [abd39a9]
- Updated dependencies [969bea6]
- Updated dependencies [7a1a5c6]
  - @hypequery/protocol@0.12.0

## 0.7.4

### Patch Changes

- Updated dependencies [5d45045]
  - @hypequery/protocol@0.11.1

## 0.7.3

### Patch Changes

- Updated dependencies [920878a]
- Updated dependencies [643abff]
  - @hypequery/protocol@0.11.0

## 0.7.2

### Patch Changes

- e370da0: Refresh every npm package page with a concise README and complete HypeQuery homepage and repository metadata.
- Updated dependencies [e370da0]
  - @hypequery/protocol@0.10.2

## 0.7.1

### Patch Changes

- Updated dependencies [6a95ba5]
  - @hypequery/protocol@0.10.1

## 0.7.0

### Minor Changes

- 24e0bd5: Capture, verify, upload, and receive multi-file project source snapshots with deployment bundles, including the API entrypoint and optional Git revision provenance.

### Patch Changes

- Updated dependencies [24e0bd5]
  - @hypequery/protocol@0.10.0

## 0.6.0

### Minor Changes

- ce908d8: Add asynchronous, snapshot-specific environment resolution to the reference
  Node worker factory so providers can isolate deployment credentials without
  mutating shared process state.

## 0.5.1

### Patch Changes

- Updated dependencies [04abd3c]
  - @hypequery/protocol@0.9.0

## 0.5.0

### Minor Changes

- 7097da6: Add generation-pinned deployment host assembly, bounded Fetch and Node data-plane adapters, duplicate-aware JSON schema parsing, activation-triggered reconciliation, and a reference filesystem host lifecycle.

### Patch Changes

- Updated dependencies [7097da6]
  - @hypequery/protocol@0.8.0

## 0.4.0

### Minor Changes

- 9a8ac57: Add a reusable protocol schema-value parser and provider-neutral deployment data-plane execution with bounded schema application, access and tenant policy enforcement, portable implementation adapters, typed SQL bindings, and activation-pinned supervised runtime dispatch. Reject ambiguous duplicate named-query routes in deployment contracts.

### Patch Changes

- Updated dependencies [9a8ac57]
  - @hypequery/protocol@0.7.0

## 0.3.0

### Minor Changes

- 3de49ce: Add a provider-neutral deployment HTTP control plane with authenticated target
  activation, current-state and bounded-history reads, and streaming Fetch and
  Node adapters.
- eb5faec: Add active-release runtime materialization with closed-bundle revalidation,
  copy-on-read artifacts, deterministic query bindings, and activation stability
  checks.
- 35af6f4: Add readiness-gated runtime supervision with atomic generation switching,
  in-flight draining, named-query invocation, and a reference Node worker factory.

## 0.2.0

### Minor Changes

- 268818b: Add target-scoped deployment activation with immutable history, atomic
  compare-and-swap semantics, rollback support, and a filesystem reference
  registry.
- 7afcf16: Add a content-addressed filesystem submission store with atomic publication,
  safe idempotent replay, stored-state verification, and partial-write recovery.

### Patch Changes

- Updated dependencies [268818b]
  - @hypequery/protocol@0.6.0
