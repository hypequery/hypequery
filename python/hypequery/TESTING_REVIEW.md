# Python datasets testing review

Reviewed on 2026-10-03 for PR #577, before merge.

## Results

The full suite passes **1,321 tests**, including all **16 live ClickHouse
cases**, with no skipped tests in the configured live run. The dataset source
coverage is **97.00% statements** (2,427 / 2,502) and **91.11% branches**
(625 / 686), or **95.73% combined coverage** in coverage.py.

| Refactored area | Statement coverage | Branch coverage |
| --- | ---: | ---: |
| Planner orchestration | 100% | No branches |
| Query validation | 100% | 100% |
| Execution admission | 100% | 100% |
| Sync/async clients | 100% | 100% |
| SQL compiler | 96.65% | 91.49% |

Ruff lint/format, strict mypy, all three import-layer contracts, and the SQL
interpolation checker pass. The datasets adapter also passes all **95 shared
SQL portability conformance fixtures**.

## Tests added by the review

Eight new cases cover argMax/argMin physical-column resolution, percentile
compilation, binding a hostile LIKE pattern as data, SQL-backed measures with
relationship joins, runtime tenant scope on an unscoped dataset, analytical
measure and SQL-expression deployment metadata, and unregistered endpoint
rejection. Deployment conversion now has 100% statement coverage and 97.73%
branch coverage.

Existing tests already cover limits, relationship resolution, tenant binding,
parameter types, result serialization, cache identity, sync/async execution,
deadlines, and cancellation. The live suite verifies parameter round trips,
sync/async client result parity, cache miss/hit parity, cancellation cleanup,
and readonly profile policy against ClickHouse.

## Reproduce and maintain

With the repository's dedicated test ClickHouse available:

```sh
uv sync --all-extras --frozen
uv run coverage erase
HYPEQUERY_TEST_CLICKHOUSE_HOST=localhost \
HYPEQUERY_TEST_CLICKHOUSE_PASSWORD=hypequery_test \
uv run coverage run -m pytest
uv run coverage combine
uv run coverage report
```

The ClickHouse CI matrix now runs the complete instrumented suite against both
configured server versions. Coverage now measures the whole `hypequery`
package: `coverage report` fails below 88% overall, and
`scripts/check_coverage.py` enforces per-package floors (datasets 95%, serve
94%, cli 90%, execution and protocol 84%). Subprocess coverage is enabled so the NDJSON
conformance adapter is counted; a parent-only run misleadingly reports that
module as untested. Generated coverage files are ignored by Git.

## Remaining gaps and limits

Eight SQL compiler lines remain uncovered: defensive checks for malformed
aggregation definitions, malformed ranges or LIKE values, unsupported
operators/scalar values, and an unscoped tenant-column guard. Several are
rejected earlier by validated models or query validation; those public
rejections have their own tests. These lines remain in the denominator.

Residual package gaps also include filesystem publication cleanup failures,
cache-store edge cases, malformed adapter inputs, relationship-resolution
errors, and rare SQL parser exits. Coverage is a regression gate rather than
proof of every possible execution. This review does not certify a new backend;
Postgres and BigQuery will require separate live semantic-equivalence tests.
