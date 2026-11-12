---
'@hypequery/cli': minor
---

Add machine output for scripts and coding agents.

- `--json` on every command. Stdout carries exactly one JSON document: the command's result, or `{ "error": { code, message, hint, category, retryable, correctable, exitCode } }`. Logs, and the package manager output of `create` and `init`, go to stderr. `deployment:status`, `deploy`, `deployment:submit`, `login`, `logout` and `skill install` return structured results. Other commands return `{ "ok": true }` for now. `examples list --json` is unchanged.
- Fixed exit codes: 0 ok, 1 correctable, 2 auth, 3 plan, 4 transient, 5 internal, 130 interrupted.
  - Sign-in failures (missing or expired Cloud credentials) now exit 2 instead of 1.
  - Network failures now exit 4 instead of 1.
  - Cloud reads (`pull`, `diff`, `deployment:status`, `generate:client --cloud`) that Cloud refuses with 401/403 exit 2; 408/429/5xx exit 4.
- `mcp --json` is refused unless `--self-test` is set, since serving MCP owns stdout.
- Prompts are refused with `INPUT_REQUIRED` when there is no terminal or `--json` is set, instead of waiting for input nobody can give. `init` without a TTY now asks for `--no-interactive`.
