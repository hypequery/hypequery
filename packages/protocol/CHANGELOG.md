# @hypequery/protocol

## 0.16.0

### Minor Changes

- 74f4843: Deployment contract 3 accepts `window` measures (`trailing`, `toDate`, or `cumulative`) and `shift` measures over a base measure of the same dataset (RFC 0015). They require a dataset `timeField` and inherit `approximate`, and derived measures may use them. `cumulative` is limited to `sum`, `count`, `min` and `max`.
- 5d798f4: Add deployment contract 3 (RFC 0015) through `validateProtocolDeploymentContractV3` and `prepareProtocolDeploymentContractV3`, with identity domain `hypequery:deployment:v3\0`. Contract 3:

  - renames the dataset filter allow-list to `allowedFilters`;
  - adds dataset `segments`, whose predicates compare the dataset's own dimensions with literals;
  - accepts `approxCountDistinct` measures with a required `approximate` marker, which derived measures inherit;
  - allows `minute`/`hour` default grains.

  A contract 3 envelope that uses none of these is rejected, because it must be published as contract 2 (the lowest-version rule). Contract 2 validation and identities are unchanged. The conformance corpus gains the `deployments-v3` family.

- 1ddd78b: Add expression extension 2 (RFC 0015) validation. Pass `{ extension: 2 }` to `validateProtocolExpression` or `validateProtocolSemanticQuery` to accept `minute`/`hour` grains, the `approxCountDistinct` aggregation, query `segments`, and one-hop relationship-qualified `measures`. Extension 1 remains the default and is unchanged. The conformance corpus gains the `expressions-v2` family, which the reference adapter announces.
- 2ddef5b: Add semantic invocation 2 (RFC 0015) through `validateProtocolSemanticInvocationV2`. It is identical to version 1, except that the operation is validated under expression extension 2. Under the lowest-version rule, a version 2 request that uses no segment, sub-day grain, or relationship measure is rejected. `validateProtocolSemanticInvocation` remains version 1 only. The conformance corpus gains the `semantic-invocations-v2` family.

## 0.15.0

### Minor Changes

- 827d32c: Accept RFC 0007 and RFC 0008, freezing deployment bundle manifest version 1
  and deployment release version 1.

  Both accepted texts record rules the implementations already enforce and the
  Proposed texts left implicit. For bundles: the `node`/`python` runtime set, a
  manifest with no artifacts being valid for a dataset-only deployment, digests
  being lowercase hexadecimal rather than case-folded, and the optional `source`
  block — its root, entrypoint, sorted and case-unique files, and git revision
  with a 40- or 64-character commit and a valid reference name for a branch.
  Path uniqueness is stated as applying under ASCII case folding across the
  deployment file, artifacts, and source files together, and a path whose
  ancestor directory is itself a declared file is rejected because the two
  cannot coexist on a real filesystem.

  For releases: `bundleIdentity` is lowercase hexadecimal, matching the bundle
  identity it names.

  Every rule was checked against both implementations before being recorded, in
  an 83-probe differential run covering the envelope, path grammar, ordering and
  uniqueness, the source block, git reference rules, target tokens, and both
  identity hashes. Neither implementation changed.

- 8dcaf88: Accept RFC 0010 and freeze compiled query 1.

  The contract fixes the closed operation set, named typed parameters carrying
  their own declarations, a closed settings allow-list applied only by trusted
  components, deadline precedence in which a caller may shorten but never extend
  the window and caller cancellation outranks expiry, a redacted debug form that
  is deliberately invalid as database SQL, and a closed public error category
  set.

  Accepted on one implementation plus a recorded obligation on the other, rather
  than on an agreement between two, and the RFC says so. The Python planner
  implements the plannable surface. `@hypequery/clickhouse` does not yet satisfy
  the parameter rule: it accepts `{name:Type}` placeholders but rewrites them
  client-side into positional markers and substitutes escaped literals into the
  statement, so a value reaches the database inside SQL text. Acceptance turns
  that into a defect against a frozen contract — the package must bind through
  ClickHouse's native server-parameter mechanism, with its public placeholder API
  unchanged. Tracked as TSP-04.

- 9c5275b: Accept RFC 0006 and freeze deployment contract version 2.

  The accepted text states the rules both implementations already enforce but
  the Proposed text left implicit: relationship `queryable` must agree with the
  relationship kind, targets must resolve within the contract, sensitivity comes
  from a closed set, a currency is three uppercase ASCII letters, an endpoint
  path is absolute, and tenant `auto-inject` declares its column.

  It adds three sections. Absent, empty, and null: an optional field is absent or
  valid, never `null` — stated because the distinction is invisible in languages
  without `undefined`. Derived measures: aliases map to base measures in the same
  dataset and the formula references exactly those aliases, over a closed
  arithmetic grammar, with names unique across base and derived together.
  Embedded SQL expressions: a malformed RFC 0005 envelope keeps its own
  `HQ_QUERY_IMPLEMENTATION_*` codes rather than being flattened into a deployment
  code.

  The shared `deployments-v2` corpus gains a rejection file — 26 cases covering
  each of those rules. The family previously had one success and one identity
  case, which cannot distinguish a faithful validator from one that accepts
  contracts another implementation rejects.

- 384b808: Accept RFC 0004 and freeze portable query schema extension version 1.

  The accepted text pins the constraint rules both implementations already
  enforce: an `object` declaring all three of `properties`, `required`, and
  `unknownProperties`; non-empty `enum.values`; at least two `union.variants`;
  and the numeric bound rules covering inclusive-with-exclusive, reversed, and
  unsatisfiable ranges.

  It also specifies defaults. `default`, `literal.value`, and `enum.values` are
  canonical values, so composites are tagged and a raw JSON array or object is
  not a default. A declared `default` must be a value its own schema accepts,
  checked when the schema is validated rather than when a request arrives, so a
  contract no caller could satisfy fails at build time. `void` declares no
  `default` field at all, making a supplied one an unknown field rather than an
  invalid value.

  The shared `query-schemas-v1` corpus grows from 13 to 24 rejection cases,
  pinning each of those rules across languages.

- 39ef77a: Accept RFC 0005 and freeze query implementation extension 1.

  The accepted text records rules both implementations already enforce and the
  Proposed text left implicit. Field sets are exact and every field is required,
  with an unknown field reported before any value on a known one. A non-string
  `kind` is a type error and an unrecognised string is an unknown kind, on the
  implementation, on a parameter source, and on a tenant policy alike;
  `sql-expression` is not a member of the implementation union, because the two
  surfaces share an error domain and a limit set but are separate validators.

  Trusted text is non-blank, where "blank" is the set `String.prototype.trim`
  removes — which includes U+FEFF, so a byte-order mark alone is blank rather
  than content. Parameter names, physical sources, and expression dependencies
  reject duplicates. A `not-required` tenant policy alongside a tenant-sourced
  parameter is a contradiction and is refused, and a `required` policy must name
  the one tenant-sourced parameter, of which there must be exactly one. An
  embedded semantic query or output schema keeps its own validation but reports
  in this surface's error domain, so a caller handles one error type.
  Entrypoints and dependencies are RFC 0002 qualified identifiers.

  Every rule was checked against both implementations before being recorded, in
  a 24-case run in which all 24 agreed. Neither implementation changed.

  The shared `query-implementations-v1` corpus grows from 9 rejections and 7
  successes to 32 and 10, pinning each recorded rule.

### Patch Changes

- 83d601f: Reject an unpaired high surrogate at the end of a string during canonical value validation. Previously `validateCanonicalValue("\ud800")` was accepted, and such a string encodes to the same UTF-8 bytes as `"�"`.

## 0.14.0

### Minor Changes

- 3eeebb2: Make the v2 deployment contract the sole supported deployment format, with dataset-owned derived measures, canonical encoding, and domain-separated identity. Reject hidden properties on deployment and local dataset contract arrays.

### Patch Changes

- 623136a: Build and rehydrate deployment contracts, including derived measures. Local dataset adapters and metrics remain available. Use one shared SQL-expression validator for dataset fields and query implementations.

## 0.13.0

### Minor Changes

- f639bd4: Carry a derived metric's authored formula in the deployment contract, so derived
  metrics execute portably instead of failing closed.

  A derived metric's contract expression already stated what the metric means: it
  inlines each input's aggregate where the formula named it. What it dropped were
  the aliases. Those are not cosmetic — they become the column names of the
  intermediate aggregate and are referenced by the outer select, so a catalog
  rebuilt without them computes the same number through different SQL. Decision
  0005 excludes a surface that cannot be made byte-identical, which is why
  `CORE-12` refused derived metrics rather than approximating them.

  `ProtocolDatasetMetric` gains an optional `derivation` carrying the inputs under
  their aliases and the formula written in terms of them. It is additive: a
  contract produced before this field stays valid, and simply remains
  non-portable. Validation proves the two forms describe one formula —
  substituting the inputs back into the authored form must reproduce the inlined
  one exactly — so they cannot disagree silently. Inputs are ordered, not sorted,
  because each becomes a column of the intermediate result in that order.

  A derivation is also held to the grammar a formula can be rebuilt from, which is
  narrower than RFC 0003: arithmetic over references and the five formula
  functions, with a literal only as a `round` precision or a `coalesce` fallback.
  Accepting a comparison, or a one-argument `round`, would publish a contract that
  validates and then fails at the point of use. Eligibility follows the metric's
  expression rather than its `kind`, because `kind` reports `grained-metric` for
  both a base metric pinned to a grain and a derived one.

  `rehydrateProtocolDatasets` rebuilds the formula by calling the same helpers in
  `formulas.ts` that authored it, rather than compiling the expression to SQL a
  second time. Those helpers carry the `toSQL` closures that decide spacing,
  parenthesisation, and function spelling, so byte-identity is structural rather
  than reimplemented and cannot drift.

  The `CORE-16` equality harness now covers derived metrics across every axis it
  already generated — grouping, all five grains, filters, ordering, pagination,
  joins, and tenant predicates — over every formula helper, including a derived
  metric pinned to a grain, whose `kind` reports `grained-metric` rather than
  `derived-metric`. A metric whose contract omits the formula still fails closed
  with `unsupported-capability`, in both rehydration and the portable executor.

- 0ba2fa6: Require dataset and endpoint tenancy to agree in both directions in a deployment
  contract. The contract already refused to publish a tenant-scoped dataset
  through an endpoint that does not require a tenant; it now also refuses the
  reverse, where an endpoint requires a tenant over a dataset that declares no
  field to scope by.

  That shape resolves a tenant and then has no column to filter on, so the query
  reads every tenant's rows while the endpoint reports tenancy as enforced. Named
  queries with a compiled-SQL implementation have always been validated in both
  directions; datasets and metrics now match.

  A contract of that shape is rejected with `HQ_DEPLOYMENT_INVALID_REFERENCE` at
  `$.datasets[i].endpoint.tenant` or `$.datasets[i].metrics[j].endpoint.tenant`.

## 0.12.0

### Minor Changes

- abd39a9: Accept RFC 0003 and freeze portable dataset expression extension version 1.

  The accepted text specifies expression depth and node accounting, independent
  collection limits, predicate-only aggregate and query filters, exact query
  identifier shapes, safe-integer pagination, deterministic validation order,
  and immutable detached validation results.

  The shared `expressions-v1` corpus now pins both sides of every protocol limit:
  depth 16/17, 1,000/1,001 expression nodes, and 100/101 collection items. It
  also covers both valid `round` arities, empty aggregate filters, the safe
  integer maximum, invalid aggregate option combinations, non-predicate filters,
  metric-query field exclusion, and invalid pagination and ordering values.

  The conformance reference adapter now materializes deterministic generators for
  success cases as well as rejection cases, allowing large exact-boundary inputs
  to remain compact in the portable corpus.

- 969bea6: Add bounded agent-oriented descriptions, examples, synonyms, formats, units, currency, timezone, freshness, ownership, sensitivity, and query defaults across dataset catalogs and deployment contracts.
- 7a1a5c6: Add portable semantic invocation records (RFC 0014): the dataset/metric
  invocation request, its result, and a closed failure record, with validators,
  limits, and stable `HQ_INVOCATION_*` codes.

  Identifiers are normalized into `operation` rather than duplicated beside it, so
  a request cannot name two different datasets. There is no tenant field: a caller
  cannot supply or change a tenant. The failure record has no field that accepts
  SQL, parameter values, tenant identifiers, physical source details, or a
  provider exception, and adds the `unsupported-capability` category decision 0005
  requires.

  These are types and validation only — no data-plane or runtime execution.

## 0.11.1

### Patch Changes

- 5d45045: Add a default export condition so CommonJS-targeting transforms can resolve the package entry point.

## 0.11.0

### Minor Changes

- 920878a: Add cache key derivation (RFC 0013, TSP-02).

  `@hypequery/protocol` gains `deriveProtocolCacheKey`,
  `deriveProtocolCacheNamespaceToken`, `ProtocolCacheKeyError`, and
  `PROTOCOL_CACHE_KEY_LIMITS`. Nothing else changes; no existing behaviour is
  affected.

  The derivation turns a canonical query preimage into an opaque store key with
  `HMAC-SHA-256` under a per-project, per-environment secret. It addresses
  PYSEC-008: the current semantic cache uses readable canonical JSON as the store
  key, so the physical source table, every filter operator and value, and the
  resolved tenant predicate and value all appear in `SCAN` output, eviction and
  expiry logs, cache-hit metric labels, and admin consoles.

  An unkeyed digest would not fix that. The preimage structure is public and the
  value space for a tenant identifier or an email is small enough to enumerate
  offline, so confidentiality requires a secret rather than a hash.

  The scheme separates namespaces two ways: an opaque namespace token forms a
  stable prefix for stores that support prefix operations, and the namespace also
  participates in the entry MAC directly, so two namespaces cannot collide even
  in a store that ignores prefixes. Rotation increments a key version and is a
  cache flush by design — entries under a retired secret become unreachable
  rather than being served.

  `@hypequery/protocol-conformance` gains the `cache-keys-v1` family, and a fix
  that reaches further: `compareSuccessOutput` only compared adapter output for
  `tagged-values-v1` and `identifiers-v1`. Every other family's success cases
  passed on `ok: true` alone, whatever they returned. Cache-key output is now
  compared, and a regression test asserts that a mismatched key, a mismatched
  namespace token, and empty output each fail.

  RFC 0013 is accepted, freezing cache key version 1 before PYC-04 implements it
  in Python. Cache namespaces use the RFC 0008 deployment-target grammar, so
  existing targets such as `project-1` do not need a second identifier mapping.
  The error precedence is also frozen as secret, namespace, version, then
  preimage, with overlap fixtures pinning the first failure.

- 643abff: Accept RFC 0001 (tagged ClickHouse value model) and align the reference
  implementation and conformance adapter with it.

  Both behaviour changes are relaxations for every real timezone identifier —
  input that was previously rejected is now accepted — so existing callers
  producing valid values are unaffected.

  **Canonical strings now permit tab (U+0009), line feed (U+000A), and carriage
  return (U+000D).** Every other C0 control, DEL, and the whole C1 range remain
  forbidden. The previous blanket C0 ban made multi-line descriptions impossible.

  **Timezone validation now accepts single-component identifiers.** The old
  pattern required a `/`, so `EST`, `GMT`, `CET`, `MST7MDT`, and `W-SU` — all
  real tzdb entries — were rejected while only `UTC` passed via a special case.
  One edge tightens: the first component must now begin with an ASCII letter,
  so a multi-component identifier with a leading underscore such as `_Foo/Bar`
  — previously accepted, never a real tzdb entry — is now rejected.
  Validation remains lexical and never consults the host timezone database:
  Python `zoneinfo` and JavaScript ICU disagree about renamed zones such as
  `Europe/Kiev` versus `Europe/Kyiv`, and conformance must not depend on the OS
  image. Identifier existence is a deployment-time check against the target
  server's `system.time_zones`. The first component must begin with a letter, so
  offset-shaped input such as `+0200` is still rejected.

  The RFC additionally pins behaviour that was previously underspecified without
  changing this implementation:

  - Metadata integers (`version`, `bits`, `precision`, `scale`, `code`) are
    defined **by value, not lexical form**. `1`, `1.0`, and `1e0` are all
    accepted and all canonicalize to `1`. A lexical rule was considered and
    rejected: JavaScript erases the distinction at parse time, so it could only
    be honoured by one language on the programmatic entry path, creating a
    cross-language divergence without preventing any confusion or hash
    collision.
  - Exact `DateTime`/`DateTime64` bounds, named the **portable v1 range** — a
    deliberately conservative subset rather than a restatement of ClickHouse's
    own limits, which differ by precision and have moved between releases.
    `DateTime64(9)` caps at `2262-04-11T23:47:16.854775807Z`, the largest
    signed-64-bit nanosecond tick count since the epoch.
  - RFC 8785 number serialization is the ECMAScript `Number::toString`
    algorithm. JavaScript inherits this from `JSON.stringify`; other languages
    must implement it explicitly and must not delegate to a host `repr` or
    default JSON encoder.
  - Map-entry depth and node counting, and which size limit binds on the
    already-parsed entry path.

  `HQ_VALUE_UNSAFE_OBJECT` was in the RFC but missing from the conformance
  manifest and from the stable-code list asserted by `fixtures.test.ts`, making
  it the one frozen failure code no implementation had to demonstrate. It now has
  a shared `unsafe-accessor` rejection case — the same generator the expression,
  schema, event, deployment, bundle, and release families already use — plus a
  requirement that each implementation declare a language-specific
  hostile-object suite.

  Fixtures grew from 18 success and 28 rejection cases to 32 and 35. The
  additions concentrate on float canonicalization boundaries, where the corpus
  previously held a single case (`1.5`) that agrees across languages by
  coincidence, and pin the failure code at every timezone edge: leading
  underscore, offset-shaped input, and the 64-byte cap (`HQ_VALUE_TOO_LARGE`,
  like every other byte-limit failure).

  The RFC 0012 language-specific hostile-object suite declaration now has a
  home in the wire protocol: an optional `hostileObjectSuite` field (`count`
  plus `mechanisms`) on the adapter `hello` message, copied by the runner into
  the run summary and rendered in reports. The reference adapter declares the
  seven mechanisms its suite covers. The runner validates the declaration and
  requires it whenever an announced fixture family contains a host-model
  conditional case, so missing or malformed evidence cannot produce a passing
  report.

  **RFC 0002 (portable identifiers) is also accepted**, with no implementation
  change. The validation order — type, empty, length, grammar, reserved — was
  already implemented but unspecified, and it is load-bearing: the grammar check
  running before the reserved-prefix check is what keeps the case-insensitive
  comparison behind an ASCII gate, where host case-folding rules agree. The
  order is now normative, the per-segment scope of the reserved namespace is
  stated, and the identifier corpus gained boundary cases at every limit
  (segment 128 bytes, 8 segments, qualified 512 and 513 bytes) plus cases
  pinning each precedence overlap. It grew from 4 success and 8 rejection cases
  to 7 and 13.

  **RFC 0012 (cross-language conformance) is also accepted.** The per-case
  timeout is pinned at 5000 ms by default, and the RFC now states that a green
  run is evidence only for the families an adapter announced — cases in
  unannounced families are reported as not run, so an adapter that announces one
  family exits zero while leaving most of the corpus untouched.

## 0.10.2

### Patch Changes

- e370da0: Refresh every npm package page with a concise README and complete HypeQuery homepage and repository metadata.

## 0.10.1

### Patch Changes

- 6a95ba5: Capture the checked-out Git branch alongside commit and dirty state in deployment source snapshots. Cloud login no longer reads or sends Git branch context; project and environment remain the only deployment-target inputs.

## 0.10.0

### Minor Changes

- 24e0bd5: Capture, verify, upload, and receive multi-file project source snapshots with deployment bundles, including the API entrypoint and optional Git revision provenance.

## 0.9.0

### Minor Changes

- 04abd3c: Add metadata-only query event and privileged query diagnostics validators with closed field sets, size caps, redaction and retention classes, and safe version evolution, per RFC 0011.

## 0.8.0

### Minor Changes

- 7097da6: Add generation-pinned deployment host assembly, bounded Fetch and Node data-plane adapters, duplicate-aware JSON schema parsing, activation-triggered reconciliation, and a reference filesystem host lifecycle.

## 0.7.0

### Minor Changes

- 9a8ac57: Add a reusable protocol schema-value parser and provider-neutral deployment data-plane execution with bounded schema application, access and tenant policy enforcement, portable implementation adapters, typed SQL bindings, and activation-pinned supervised runtime dispatch. Reject ambiguous duplicate named-query routes in deployment contracts.

## 0.6.0

### Minor Changes

- 268818b: Add target-scoped deployment activation with immutable history, atomic
  compare-and-swap semantics, rollback support, and a filesystem reference
  registry.

## 0.5.0

### Minor Changes

- 3a8cad6: Add deterministic target-bound deployment release envelopes and a CLI command
  that prepares them only from fully verified deployment bundles.

## 0.4.0

### Minor Changes

- b92a0a1: Add versioned deployment bundle manifests, canonical identities, deterministic
  bundle directory builds, and strict filesystem verification for deployment and
  runtime artifact bytes.

## 0.3.0

### Minor Changes

- 05d2a4d: Add canonical deployment contract encoding and domain-separated identities, expose deployment generation on Serve APIs, and add CLI build and validation commands for deployment artifacts.

## 0.2.1

### Patch Changes

- 90c02f7: Reject grained deployment metrics whose fixed grain is not included in their supported grains, and require a dataset time field for every grained metric.

## 0.2.0

### Minor Changes

- 28e998f: Add the portable Dataset deployment contract, strict protocol validation, and
  Dataset/Serve adapters for producing deployment artifacts from existing
  definitions.

## 0.1.0

### Minor Changes

- 83847f5: Add the public protocol package scaffold and document ownership, versioning,
  compatibility, and export boundaries for portable Hypequery artifacts.
