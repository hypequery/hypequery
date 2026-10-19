# Installed Python client release gate

With a reachable ClickHouse instance and workspace dependencies installed:

```bash
# Supply CLICKHOUSE_HOST/PORT/USERNAME/PASSWORD (and SECURE when needed).
bash scripts/smoke-python-client-release.sh
```

The caller needs permission to create/drop one randomly named test database and
observe/kill its own queries. The script never reuses an existing database.
It builds/installs artifacts outside the checkout, uses loopback ports 8000/5173,
starts owned HTTP processes, and removes its database/processes on exit. It
retains diagnostics and the prepared artifact directory. It does not publish.
The two gate user credentials are public test data, not service credentials.

The gate runs:

- Offline Python export, generated TypeScript drift check, strict frontend build,
  clean npm tarball audit and backend-free browser bundle audit.
- Actual SDK stdio → installed CLI → Python → ClickHouse queries for two tenants,
  nullable decimal values, fixed metric aliases, pagination and rejected SQL/context.
- Headless Chromium with all four hooks concurrently, both pagination terminations,
  A→B→A isolation, actual schema headers and no browser console/request errors.
- Generated, strictly compiled React hooks, direct HTTP and actual MCP stdio
  compared with independent raw SQL for related dimensions/measures, missing
  targets, cross-tenant join guards, HAVING and timezone-sensitive day boundaries.
  Decimal strings compare exactly without conversion to JavaScript numbers;
  number-valued aggregates still fail the wire-type check. A related decimal
  exceeds JavaScript's safe-integer range to detect lossy conversion.
- Browser HTTP errors from real Python handlers: successful token refresh, a
  persistent 401 limited to one refresh/retry, and 400/403/409/429/500/503 without
  auth refresh or query retries. Verify schema pins, CORS, canonical safe error
  envelopes, no-store/request IDs and rate-limit response headers. Unexpected
  exception text must not reach the browser.
- Installed MCP rejects unauthorized/forbidden discovery and, through the SDK
  protocol adapter, expired credentials before a data POST, without replay.
- Actual MCP SDK cancellation after observing a slow query in `system.processes`,
  followed by an executor deadline. Each must stop database work before the
  three-second query could complete naturally. A response-only abort cannot pass.

`qualification.json` records source SHA, worktree state, actual Python/Node/
ClickHouse/browser/npm versions, generated hashes, artifact SHA-256 checksums,
query/header counts and cancellation timings. `status.json` records the stage
and exit status, including early failures. Screenshots and service logs remain
available for diagnosis. No environment dump or credential headers are retained.

The reusable `python-clients.yml` workflow runs two deliberate full journeys:

| Python | ClickHouse | React | Browser |
| --- | --- | --- | --- |
| 3.11 | 25.8 | 18 | Chromium |
| 3.14 | 26.3 | 19 | Chromium |

This is a compatibility subset. Existing Python quality/artifact jobs still cover
3.11–3.14, and existing database tests cover both ClickHouse versions. It does not
claim every Cartesian combination or Firefox/WebKit coverage.

Both main CI and reusable Python CI require this workflow. npm stable/canary
jobs now depend on the combined client gate as well as the package build. Tagged
Python releases/rehearsals reuse Python CI at the selected commit; automated
Python canaries already require that exact commit's successful Python workflow.
No test job inherits publish secrets or permissions. Required-check settings in
GitHub must include the new checks; YAML cannot configure branch protection.

To verify the gate detects failures, set one test-fixture fault and expect the
command to exit nonzero:

```bash
HYPEQUERY_GATE_FAULT=stale bash scripts/smoke-python-client-release.sh
HYPEQUERY_GATE_FAULT=cors bash scripts/smoke-python-client-release.sh
HYPEQUERY_GATE_FAULT=tenant bash scripts/smoke-python-client-release.sh
HYPEQUERY_GATE_FAULT=wire bash scripts/smoke-python-client-release.sh
HYPEQUERY_GATE_FAULT=mcp bash scripts/smoke-python-client-release.sh
HYPEQUERY_GATE_FAULT=related-wire bash scripts/smoke-python-client-release.sh
```

These corrupt generated output, browser CORS, tenant mapping, aggregate wire type
or backend execution respectively; `related-wire` corrupts a related measure. They only affect the test fixture. No fault
is enabled in normal CI. `HYPEQUERY_TUTORIAL_REACT_MAJOR=18` selects the React 18
consumer; default is 19. `HYPEQUERY_GATE_BROWSER_EXECUTABLE` may select a local
browser; CI uses the pinned Playwright Chromium install.

Remaining beta gates include exact published npm/PyPI versions, publisher/OIDC
configuration and release rehearsal. Green development-artifact CI alone does
not authorize a release announcement.

The related-field extension uncovered empty-string/zero defaults for absent
joined targets. It requires the Python planner fix that guards qualified fields
and groups/orders by the guarded expression. The fixtures include another
tenant's matching target key, so an incorrect join cannot pass by returning a
plausible aggregate. The extra browser bundle is independently audited for
backend imports, and strict types require selected related values to be
`string | null`. Raw SQL preserves its own decimal formatting; canonicalization
removes only insignificant zeroes without losing precision or accepting numbers.
