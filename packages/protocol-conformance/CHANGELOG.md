# @hypequery/protocol-conformance

## 0.12.0

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

- Updated dependencies [827d32c]
- Updated dependencies [8dcaf88]
- Updated dependencies [9c5275b]
- Updated dependencies [384b808]
- Updated dependencies [83d601f]
- Updated dependencies [39ef77a]
  - @hypequery/protocol@0.15.0

## 0.11.2

### Patch Changes

- Updated dependencies [3eeebb2]
- Updated dependencies [623136a]
  - @hypequery/protocol@0.14.0

## 0.11.1

### Patch Changes

- Updated dependencies [f639bd4]
- Updated dependencies [0ba2fa6]
  - @hypequery/protocol@0.13.0

## 0.11.0

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

### Patch Changes

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

- Updated dependencies [abd39a9]
- Updated dependencies [969bea6]
- Updated dependencies [7a1a5c6]
  - @hypequery/protocol@0.12.0

## 0.10.4

### Patch Changes

- f8ea8a9: Add exact adapter-family assertions for release-grade conformance gates.

## 0.10.3

### Patch Changes

- 754c304: Add exact adapter-family assertions for release-grade conformance gates.

## 0.10.2

### Patch Changes

- 1727a8b: Add deterministic portable-identifier fuzz seeds to the shared conformance corpus.

## 0.10.1

### Patch Changes

- e341d94: Expand the tagged-values-v1 fixture snapshot to cover every RFC 8785 Appendix B number.

## 0.10.0

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

### Patch Changes

- Updated dependencies [920878a]
- Updated dependencies [643abff]
  - @hypequery/protocol@0.11.0

## 0.9.2

### Patch Changes

- e370da0: Refresh every npm package page with a concise README and complete HypeQuery homepage and repository metadata.
- Updated dependencies [e370da0]
  - @hypequery/protocol@0.10.2

## 0.9.1

### Patch Changes

- Updated dependencies [24e0bd5]
  - @hypequery/protocol@0.10.0
