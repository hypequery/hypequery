# Decision 0005: Portable semantic execution

- Status: Proposed
- Date: 2026-09-03
- Owners: Hypequery Core and Cloud maintainers

## Context

Decision 0002 introduced first-class semantic invocation and deliberately left
the executor open: "The semantic executor may be portable native execution or a
supervised runtime binding. Both implement the same invocation contract and
policy context."

`CORE-12` inherits that openness by targeting "the activated deployment
runtime/portable semantic executor", and `DEPLOY-204` already requires a
"protocol-contract-to-semantic-executor bridge" that does "not require source
TypeScript in the gateway". The mechanism is unnamed, so the work cannot be
sequenced or gated.

The choice is load-bearing. Portable native execution compiles a query from the
activated contract and runs no customer code. A supervised runtime binding
executes the deployed bundle's JavaScript in an isolated executor. They differ
in cost, operational surface, and the kind of failure they risk.

The deployment data plane currently makes only `deployment.queries` executable,
so no dataset or metric endpoint can execute at all. Hosted MCP is blocked on
resolving this.

## Decision

Semantic invocation executes through **portable native execution**. The executor
resolves the dataset or metric from the validated active contract, rebuilds an
executable catalog from that contract, and plans the query with the existing
semantic planner. No customer module is loaded and no isolated runtime is
required.

The supervised runtime binding remains a valid implementation of the same
invocation contract, as decision 0002 requires. It is not built now. It becomes
the escape hatch for deployments that cannot be expressed declaratively.

### Why the contract is sufficient

A deployed dataset already carries dimensions with column mappings, measures
with aggregation and field plus optional raw SQL, filters with operators,
relationships, limits, tenant key, time key, and supported grains.
`DatasetCatalog` is pure data with no functions.

Derived metrics are also declarative. `formulas.ts` states that formula helpers
"are symbolic — they build `FormulaExpr` objects that get compiled to SQL by the
semantic query engine. They do not produce raw SQL strings directly." The
carried value is a `SemanticExpression` of `ref | literal | binary | function`.
`MetricCatalogEntry` currently discards it, which is an additive gap rather than
a structural obstacle.

### Rebuilt catalogs must not diverge

The risk of this decision is that a catalog rebuilt from the contract produces
different SQL from the authored one, so a deployment behaves differently in
managed execution than in local development.

This is mitigated by construction, not by review: both sides run the same
planner over the same catalog shape. It is verified by a required equality
harness that asserts a rebuilt catalog emits byte-identical SQL to the original
across a query corpus covering dimension subsets, measure combinations, filter
operators, time grains, ordering, pagination, joins, and tenant predicates.

If the harness cannot be made to pass, this decision is void for the affected
surface and the supervised runtime binding is required there.

### What does not change

Every guarantee in decision 0002 is unaffected. Portable execution sits behind
the same invocation contract and therefore inherits generation pinning, the rule
that a caller cannot supply a tenant, the requirement to fail closed when a
required tenant cannot be enforced, secret ownership inside the hosted
generation, and the stable failure categories.

## Consequences

- Dataset and metric endpoints become executable without an isolated executor,
  removing the runtime executor from the hosted MCP critical path.
- Customer code executes only on the author's machine at deploy time. It never
  runs on Hypequery infrastructure.
- Cloud gains a permanent obligation to interpret every contract version it has
  accepted, because releases are immutable and rollback is supported. Contract
  versioning becomes a compatibility surface with its own tests.
- Rebuilt catalogs should be cached per release. Releases are immutable and
  content-addressed, so release identity is an exact cache key.
- Deployments that need genuinely dynamic behaviour are unsupported in managed
  execution until the supervised runtime binding exists, and must be rejected
  with a clear error rather than executed with different semantics.

## Rejected alternatives

- **Build the supervised runtime binding first:** rejected because it puts
  isolated compute on the critical path for queries that carry no code, and adds
  a permanent per-request cost and operational surface before demand is proven.
  It also inverts the risk profile: a rebuilt-catalog defect is a wrong result
  caught by tests, whereas an isolation defect is a cross-tenant incident.
- **Emit `compiled-sql` for every dataset request at deploy time:** rejected for
  the same reason decision 0002 rejected generating one named query per tool
  call. Dataset selection is combinatorial in dimensions, measures, filters,
  grains, and ordering, so it cannot be enumerated in advance. `compiled-sql`
  remains appropriate for fixed-shape named queries.
- **Execute a dataset client directly in the Cloud gateway:** already rejected by
  decision 0002 because it bypasses deployment generation and secret ownership.
  Portable execution lives inside the deployment host for the same reason.
- **Leave the executor unspecified until implementation:** rejected because the
  choice determines the infrastructure Cloud must operate, and hosted MCP cannot
  be sequenced while it is open.
