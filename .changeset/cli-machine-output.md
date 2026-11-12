---
"@hypequery/cli": minor
---

Make every CLI command usable by scripts, CI and coding agents (AG-07):

- `--json` on every command prints exactly one JSON document on stdout (logs go to stderr, without colour). Failures print the same `{ error: { code, message, hint, docsUrl, category, retryable, correctable, exitCode, requestId?, issues? } }` envelope as Cloud's `/v1` API and MCP.
- Fixed exit codes: `0` ok, `1` user-correctable, `2` auth, `3` plan, `4` transient (retry), `5` internal, `130` interrupted, `143` terminated. ClickHouse or Cloud being unreachable now exits `4` instead of `1`; a missing or expired Cloud credential exits `2`.
- No prompts without a terminal, with `--json`, the new `--no-input` flag or `CI`: anything the CLI would ask fails fast with `INPUT_REQUIRED` (exit `1`) naming the flag to pass. Without a terminal, `init` behaves like `init --no-interactive`.
- `init --no-interactive` with existing files and no `--force` now fails with `CONFIRMATION_REQUIRED` (exit `1`) instead of exiting `0` without writing anything.
- `login --no-input` (or in CI) fails fast with exit `2` instead of waiting for a browser.

See "Scripts, CI and coding agents" in the CLI reference.
