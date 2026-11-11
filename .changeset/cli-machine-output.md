---
'@hypequery/cli': minor
---

Add machine output for scripts and coding agents.

- `--json` on every command. Stdout carries exactly one JSON document: the command's result, or `{ "error": { code, message, hint, category, retryable, correctable, exitCode } }`. Logs go to stderr. `deployment:status`, `deploy`, `deployment:submit`, `login`, `logout` and `skill install` return structured results. Other commands return `{ "ok": true }` for now. `examples list --json` is unchanged.
- Fixed exit codes: 0 ok, 1 correctable, 2 auth, 3 plan, 4 transient, 5 internal, 130 interrupted.
  - Sign-in failures (missing or expired Cloud credentials) now exit 2 instead of 1.
  - Network failures now exit 4 instead of 1.
- Prompts are refused with `INPUT_REQUIRED` when there is no terminal or `--json` is set, instead of waiting for input nobody can give. `init` without a TTY now asks for `--no-interactive`.
