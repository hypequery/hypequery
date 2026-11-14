---
"@hypequery/cli": minor
---

Every hypequery Cloud operation is now a CLI command, `hypequery <group> <action>`: `projects`, `releases`, `drafts`, `connections`, `logs`, `usage`, `audit`, `tenants`, `permission-sets`, `customer-access`, `signing-keys`, `members`, `org`, `deploy-keys`, `api-keys`, `management-tokens`, `feedback` and more (91 operations in 25 groups). The commands are built from Cloud's operations spec and call it through `@hypequery/cloud-client` with the credential from `hypequery login` or `HYPEQUERY_API_TOKEN`.

- Path parameters are positional (`hypequery releases rollback v12`), other fields are flags named after the input (`--expected-revision`), and `--input-json` takes the whole input as JSON (inline, `@file` or `-`). `--project` defaults to the project your sign-in names.
- Each command prints the operation's output as JSON; with `--json` it is the one document on stdout. Failures carry Cloud's error envelope (code, hint, docs URL, request ID, issues) and the fixed exit codes.
- Destructive operations need `--yes`; at a terminal the CLI asks instead, and without one it refuses with `CONFIRMATION_REQUIRED` before calling Cloud.
- Secret inputs (a ClickHouse password, an OIDC client secret) come from stdin (`--password-stdin`) or a hidden prompt, never a flag value. New keys and signing keys are printed to stdout once, with a warning on stderr.

Telemetry records these invocations as one command, `cloud-operation`, without which operation ran.
