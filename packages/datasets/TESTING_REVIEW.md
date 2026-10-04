# Dataset testing review

Reviewed on 2026-10-04 for the TypeScript dataset refactor (#580), SQL dialect
seam (#583), and Python planner refactor (#577). The dialect seam was rebased
onto main after #575, #577, and #580 merged.

## Evidence and gates

| Implementation | Tests | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: | ---: |
| TypeScript datasets, unit + live ClickHouse | 1,478 | 95.30% | 91.14% | 97.39% | 95.99% |

The unit-only baseline was 83.74% lines and 81.86% branches. Combining the
existing integration tests raised it to 92.91% lines and 87.56% branches;
116 additional cases close the gaps described below. Coverage includes all
production source files, including currently unused window dependency helpers.
Only test files, test support, and the API type test are excluded.

Run `pnpm --filter @hypequery/datasets test:coverage:full` with Docker. The
existing harness creates and seeds ClickHouse, runs unit and integration tests
in one instrumented run, and cleans up the container. The command also supports
an explicitly configured `CLICKHOUSE_TEST_HOST` as used in CI; the harness
seeds that configured test database. Reports are in `coverage/full`.

CI now enforces minimums of 95% statements, 95% lines, 90% branches, and 97%
functions. CI also runs for PRs targeting `codex/` branches so stacked PRs
receive the gate before retargeting to main. Production files remain in the denominator. Type tests, package
builds, lint, and downstream Serve tests are separate checks.

## Behaviors checked

- All 95 existing live dataset cases pass: base/derived queries, relationship
  joins, tenant enforcement, timezones, windows, shifts, pagination, and caches.
- The existing byte-identical SQL corpus compares direct query-builder SQL with
  dataset SQL. The dialect seam also checks legacy/default SQL equality, actual
  hook output, identifier escaping, and per-request factory restoration.
- Base and derived metrics preserve custom quoted SQL through execution with a
  runtime factory override, then restore default quoting on subsequent requests.
  Both execution paths share pagination, serialization, and result metadata
  through the same result helper.
- Base and derived dataset compilation previews use the active runtime dialect,
  preserve pagination overfetch, and match execution SQL after the builder move
  introduced by #575. Subsequent previews restore default quoting.
- Both implementations pass all 95 shared SQL portability fixtures. These prove
  portability-expression conformance; they do not certify Postgres or BigQuery
  execution, which this initial seam does not implement.
- New schema-adapter cases cover portable Zod types, required properties,
  unknown-property policies, descriptions, bounded strings/numbers/arrays,
  native enums, discriminator literals, canonical nested defaults, and rejection
  of unsupported schemas with the failing property path.
- Fixed measure filters cover every operator, escaped literals, finite numbers,
  array/range shape errors, conditional aggregate semantics, and unsupported
  argMin/argMax filters. Contract rehydration preserves authored values and
  rejects malformed expressions.
- Metric cases cover invalid pagination, query limits, qualified filters,
  operator allowlists, type errors, segments inside derived CTEs, outer ordering,
  and tenant rejection by the standalone compilers.
- Window compilation is exercised through `toSQL`, in addition to live
  execution. Metadata cases cover UTF-8 size limits and invalid defaults,
  freshness, grain selections, and duplicate entries.

## Remaining coverage and review limits

The dialect resolver and ClickHouse identifier implementation have 100%
statement/branch coverage. Metric orchestration and the base/derived/time SQL
dispatch have 100% statement coverage. Some defensive compiler guards duplicate
checks made earlier by public validation; malformed definitions also have
separate validation tests.

The residual package gaps include uncommon SQL parser exits, malformed formula
validation, protocol derivation/expression rehydration, legacy in-memory/backend
paths, and some executor error paths. They remain measured by the package gate;
this review does not claim exhaustive coverage or mutation-test proof.

The SQL equality renderer is a test implementation, so live ClickHouse tests
provide independent execution evidence. The current gate is ClickHouse-specific;
new backends will need their own live semantic-equivalence suites before support
is claimed. See the Python PR's `python/hypequery/TESTING_REVIEW.md` for its
coverage method and remaining planner guards.
