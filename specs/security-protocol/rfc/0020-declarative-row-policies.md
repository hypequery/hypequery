# RFC 0020: Declarative row policies

- Status: Proposed
- Version: row policies 1
- Extends: RFC 0019 (enforced constraints), RFC 0013 (cache keys), RFC 0014
  (trusted context)

## Summary

Row-level security in a dataset today is one rule: a dataset declares a
`tenantKey`, and the runtime's trusted `tenant` (`eq`, `in`, or
`scope: 'all'`) is applied as a predicate on it. RFC 0019 adds enforced
constraints, resolved per call by a provider, but only in the deployment data
plane. A local `createDatasetClient` or Serve application can't use them.

This RFC generalizes both into one mechanism with two sources:

1. **Enforced constraints** (per call). RFC 0019 comparisons supplied by the
   application's trusted context as `context.runtime.constraints`, never by
   the caller's query.
2. **Row policies** (per dataset). Declarative rules on the dataset, each
   binding a field and an operator to a named trusted runtime attribute, with
   values read from `context.runtime.attributes`.

`tenantKey` with `runtime.tenant` becomes sugar for one row policy. Its
behaviour doesn't change.

Every predicate either source resolves is applied at one point in the planner,
enters the cache-key preimage, and fails closed.

## Motivation

- **Tenancy isn't the only row rule.** Embedded analytics needs rules like "a
  regional manager sees their regions" or "a partner sees accounts they own".
  Today each of these is a caller filter, which the caller controls, or a
  separate dataset per audience.
- **Enforcement is scattered.** The tenant predicate is applied separately in
  six places: the aggregate builder, the metric builder, the derived-metric
  builder, the time-measure source, relationship join planning, and the
  backend plan. A seventh query shape that forgets to apply it leaks rows.
- **Caching is the biggest leak risk.** A predicate that changes rows but not
  the cache key serves one principal's rows to another. The tenant gets this
  right through special cases in two key derivations, and a new rule would
  need the same special cases.
- **Local and hosted paths disagree.** A constraint that works through the
  Cloud data plane can't be expressed locally, so a policy can't be tested
  before it's deployed.

## Model

### Enforced constraints (local)

```ts
await client.execute(orders, { measures: ['revenue'] }, {
  runtime: {
    tenant: 'acme',
    constraints: [{ field: 'region', operator: 'in', value: ['EU', 'UK'] }],
  },
});
```

`runtime.constraints` is a list of plain `field operator value` comparisons in
the dataset's filter vocabulary: a declared filter, or a one-hop
`relationship.field`, with the same operator and value rules as a caller
filter. That is exactly the RFC 0019 shape, so a constraint means the same
thing locally and in the data plane. The data plane's resolver output can be
passed through unchanged.

A constraint the dataset can't enforce refuses the call. Reasons include an
unknown field, a disallowed operator, a value of the wrong type, or too many
constraints for the dataset's filter ceiling. The message doesn't describe the
constraint (RFC 0019): `Dataset "orders" cannot enforce a runtime constraint.`

Constraints are a property of the call, not the dataset. They apply to the
queried dataset. They don't apply to joined relationship targets, except
through a constraint on a `relationship.field`, which filters base rows by
the joined value just as a caller filter would.

### Row policies (per dataset)

```ts
const orders = dataset('orders', {
  source: 'analytics.orders',
  tenantKey: 'tenant_id',
  rowPolicies: {
    region: { field: 'region_code', operator: 'in', attribute: 'regions' },
    owner: { field: 'account_manager_id', operator: 'eq', attribute: 'userId' },
  },
  // ...
});

await client.execute(orders, query, {
  runtime: {
    tenant: 'acme',
    attributes: { regions: ['EU', 'UK'], userId: 'u_42' },
  },
});
```

- `field` is a physical column of the dataset's source, the same kind of value
  `tenantKey` is. It doesn't need to be a published dimension or filter. A
  policy can restrict on a column the dataset never exposes.
- `operator` is `eq` or `in`. Range policies (`lte` on a clearance level) are
  a possible later extension. They aren't needed for any rule motivating this
  RFC.
- `attribute` names a key of `runtime.attributes`. An `eq` policy needs a
  string, number or boolean, and an `in` policy needs a non-empty array of
  them. Any other shape refuses the call.
- **No functions.** A policy is data. A function would be invisible to the
  RFC 0013 definition identity: two deployments with different function
  bodies would share cache keys. It also couldn't be serialized into a
  deployment contract or evaluated by another runtime, such as Python or the
  Cloud data plane. Anything a function would compute belongs in the
  application's context resolver, which produces `attributes`.

`tenantKey: 'tenant_id'` lowers to a policy on `tenant_id`, bound to the
runtime tenant, with operator `eq` or `in` depending on the tenant's shape.
Its validation and refusal messages don't change.

### Resolution and semantics

For one dataset in one call, the **row scope** is the list of predicates from:

1. the tenant policy, when the dataset has a `tenantKey` and the runtime
   resolves a tenant;
2. each row policy, with its attribute's value;
3. each enforced constraint, for the queried dataset only.

The rules for applying it:

- **AND, never OR.** Every predicate is ANDed with the caller's filters and
  segments. No source can widen what another narrows. The position of the
  predicates in the SQL text is not part of the contract.
- **Applied at the source, below everything else.** Predicates restrict the
  rows the source yields, before aggregation, windows, time shifts, derived
  measures or `having` see them. A window measure therefore can't accumulate
  rows the principal can't see, even from before the queried period.
- **Joined to-one targets apply their own policies.** A join to a target with
  a `tenantKey` or `rowPolicies` scopes the joined rows in the join condition.
  An out-of-scope target row behaves exactly like a missing one: its fields
  are NULL. The same applies to relationship measures.
- **Fail closed.** A dataset with policies whose attribute is missing or
  malformed refuses the call (`Dataset "orders" requires runtime attribute
  "regions".`). A dataset with a `tenantKey` and no runtime tenant already
  refuses.
- **Explicit bypass.** `tenant: { scope: 'all' }` is the existing trusted
  cross-tenant scope. The policy equivalent is
  `attributes: { regions: { scope: 'all' } }`, scoped to one attribute, never
  a global "skip policies" switch. A bypass is a trusted value like any other.
  It enters the cache key (as `all`) and is reported to the audit hook
  (RFC 0011 query events) with the policy name. A bypass with no audit hook
  configured refuses the call. See decision 1.
- **Callers can't filter on a policy column.** Caller filters on the tenant
  column are already refused while tenancy is active. The same refusal
  extends to every column a policy covers, so that a caller can't probe
  whether a row exists outside their scope through a contradictory filter's
  empty result. Constraints are trusted and exempt.

### Cache keys (RFC 0013)

Every resolved predicate value enters the cache-key preimage. This RFC treats
that as a MUST and the rest as implementation detail:

- Constraints are added to the preimage query's `filters`. The preimage sorts
  and deduplicates filters (AND is commutative), so a constraint and an
  identical caller filter produce the same key. That is correct, because they
  produce the same rows.
- Row policy values enter a new preimage member, `scope`: a sorted list of
  `{ policy, mode: 'scoped', values }` or `{ policy, mode: 'all' }` entries,
  with values HMAC-fingerprinted under the namespace secret exactly as tenant
  ids are today. A preimage without policies omits the member, so existing
  keys don't change.
- Policies on a joined target enter the key whenever the query joins that
  target, as the tenant does today.
- The policy declarations themselves (`field`, `operator`, `attribute`) are
  part of the dataset definition, and so of the definition identity. Changing
  a policy invalidates every key for the dataset.

The protocol preimage change (the `scope` member) is the only wire change in
this RFC, and it lands with phase 2.

### Catalogs and discovery

Catalogs, agent-safe catalogs and deployment contracts publish each policy's
name, field and attribute name, and a `requiresAttributes` list per dataset,
so a provider can tell which context a dataset needs. They never publish
values. The deployment contract carries policies as data, so the data plane
can enforce them without the application's code (decision 0011).

### Raw SQL

A dimension, measure or filter with a raw `sql` expression can read anything
the database user can, including other tables through a subquery. A row
predicate restricts the dataset's source, not what an expression inside it
reads. Options:

- **(a) Refuse subqueries.** Reject `sql` expressions containing `SELECT`
  (after string and comment stripping) on datasets that have row policies or
  a `tenantKey`, at definition time.
- **(b) Document it.** Raw SQL is author-trusted code. Authors are
  responsible, and the DB-native layer (below) is the backstop.
- **(c) Refuse raw SQL altogether** on policy-bearing datasets.

This RFC takes (a). It targets the one construct that reads outside the
scoped source, without banning the expressions many datasets need.
`dictGet` and table functions have the same problem and go on the same deny
list. See decision 2.

### Defense in depth: DB-native policies (later phase)

The compiler is the choke point, and a compiler bug is the remaining failure
mode. A database-side policy catches it:

- **ClickHouse.** Generate DDL such as
  `CREATE ROW POLICY hq_orders_tenant ON analytics.orders USING tenant_id = getSetting('SQL_hq_tenant') TO hq_app`.
  The client sends the matching custom settings (`SQL_hq_tenant`,
  `SQL_hq_regions`, ...) with each query. `in` policies use
  `has(splitByChar(',', getSetting(...)), col)` or an array-typed setting.
- **Postgres.** RLS policies `USING (tenant_id = current_setting('hq.tenant'))`
  plus `SET LOCAL hq.tenant = ...` inside the query's transaction.

This guards against compiler bugs only. The settings are sent by the same
application, so a compromised application sets whatever it likes. It costs a
DDL deployment step and a database user per application. It's opt-in, emitted
by the CLI (`hypequery policies sql`), and never applied automatically. See
decision 3.

## Implementation phases

1. **One choke point (this RFC's first PR).** Route the tenant predicate
   through a single source-scoping step used by every builder-path query shape
   and by relationship joins. Add local `runtime.constraints` with RFC 0019
   validation, cache-key coverage and fail-closed refusal on the deprecated
   backend path. Add a property-style test that runs every query shape under
   a constraint and a tenant and asserts that both are applied. No change to
   generated SQL for existing queries.
2. **Row policies.** Add `rowPolicies` and `runtime.attributes`, the bypass
   and the audit hook it requires, the refusal of caller filters on policy
   columns, the cache preimage `scope` member, catalog and contract
   publication, and data-plane enforcement from the contract. Add the raw SQL
   rule for `rowPolicies` datasets and the warning for `tenantKey`-only ones
   (decision 2), and the backend-path refusal (decision 4).
3. **Parity.** Python SDK and protocol conformance fixtures for policy
   resolution, refusals and cache keys.
4. **DB-native policies** (if accepted): DDL generation and per-query
   settings for ClickHouse, then Postgres.

## Decisions

The four questions this RFC left open are settled below. Luke accepted all
four on 2026-11-19. The RFC itself stays Proposed until the phase 2
conformance fixtures land.

1. **Bypass semantics: per attribute, and only with an audit hook.**
   - The bypass is `attributes: { <name>: { scope: 'all' } }`. It lifts every
     policy bound to that attribute and nothing else. There is no per-policy
     or global bypass.
   - Phase 2 adds an audit hook to the dataset client, called with RFC 0011
     query events. A call that carries any attribute bypass refuses unless the
     hook is configured. The hook receives each bypassed policy's name and
     dataset, never attribute values.
   - The existing tenant `scope: 'all'` keeps working without a hook, so
     current users don't break. It is reported to the hook when one is
     configured. Requiring the hook for it too is left to the next major.
2. **Raw SQL rule: option (a), on `rowPolicies` datasets now.**
   - At definition time, refuse `SELECT`, `dictGet`/`dictGetOrDefault`, and
     table functions in any `sql` expression, after stripping string literals
     and comments. This applies to datasets that declare `rowPolicies`.
   - `tenantKey`-only datasets get the same rule in the next major, because
     it changes existing projects. Until then the definition only warns.
   - A host that runs other people's deployments (a hosted data plane) MAY
     refuse these expressions on `tenantKey`-only datasets at intake now.
3. **DB-native policies: in scope as phase 4, opt-in.**
   - `hypequery policies sql` generates the DDL. The runtime sends the
     matching settings on every query once a deployment opts in. Neither is
     ever applied automatically.
   - A connection check reports whether each policy-bearing table is covered
     and whether the connecting user is bound by the policy.
   - Phase 4 can follow phase 2. The recipe ships in the docs with phase 2.
4. **Backend path: refuse row policies.** The deprecated plan/backend path
   refuses a dataset with `rowPolicies`, and any call with
   `runtime.attributes`, as it already refuses constraints and `final`. It
   does not lower policies into plan filters.

## Security

Constraints, attributes and the tenant come only from trusted context. A
query, an invocation record (RFC 0014) or a tool call has no field for any of
them, and none may be added. A runtime that can't resolve a value a policy
requires refuses the call. It never runs unrestricted. A predicate that
changes rows but not the cache key is a cross-principal data leak and is
treated as a security bug.
