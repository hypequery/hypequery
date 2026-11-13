---
'@hypequery/cli': minor
---

Finish machine output for scripts and coding agents (AG-07-b).

- Every command now returns a structured `--json` result instead of `{ "ok": true }`: `init`, `create`, `dev` (once listening), `mcp --self-test`, `generate`, `generate:types`, `generate:datasets`, `generate:manifest`, `generate:client`, `export:client-contract`, `deployment:build`, `deployment:validate`, `deployment:release`, `pull`, `diff` and `telemetry`.
- Error envelopes use decision 0003's nine categories, as Cloud's `/v1` and MCP do (`unauthenticated` instead of `unauthorized`, `budget_exceeded` instead of `plan`), and always carry a `hint` and `docsUrl`. They relay Cloud's own hint and `requestId`, and list affected files in `issues`.
- `--check` and `--diff` misses report `OUT_OF_DATE` (category `stale_contract`, still exit 1), and refused overwrites report `OUTPUT_EXISTS`.
- New global `--no-input`, and `CI`, refuse every prompt with `INPUT_REQUIRED` naming the option to pass. `login` fails fast with exit 2 instead of waiting for a browser.
- `init --no-interactive` over existing files now fails with `CONFIRMATION_REQUIRED` instead of exiting 0 without writing.
- Cloud 402 exits 3 and 409/412 reports `CLOUD_STATE_CHANGED`. A hosted `mcp --self-test` refused with 401/403 exits 2, and an unreachable one exits 4.
- Commander's argument errors print an envelope with `--json`, and a large `--json` document is fully written before the process exits.
