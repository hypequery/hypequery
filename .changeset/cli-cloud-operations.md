---
"@hypequery/cli": minor
---

Every hypequery Cloud operation is now a CLI command, `hypequery <group> <action>`: `projects`, `releases`, `drafts`, `connections`, `logs`, `usage`, `audit`, `tenants`, `permission-sets`, `customer-access`, `signing-keys`, `members`, `org`, `deploy-keys`, `api-keys`, `management-tokens`, `feedback` and more (92 operations in 25 groups; `organization.update` is `hypequery org update`). The commands are built from Cloud's operations spec and call it through `@hypequery/cloud-client` with the credential from `hypequery login` or `HYPEQUERY_API_TOKEN`.

- Operations need a management token (`hqmt_`), from `hypequery login`, `hypequery login --device` or `HYPEQUERY_API_TOKEN`. A deploy key or the browser sign-in's deploy credential alone is refused with `CLOUD_MANAGEMENT_TOKEN_REQUIRED` before anything is sent. Each Cloud call times out after 60 seconds (`CLOUD_TIMEOUT`, exit 4).
- Path parameters are positional (`hypequery releases rollback v12`), other fields are flags named after the input (`--expected-revision`), and `--input-json` takes the whole input as JSON (inline, `@file` or `-`). `--project` defaults to the project your sign-in names.
- Each command prints the operation's output as JSON; with `--json` it is the one document on stdout. Failures carry Cloud's error envelope (code, hint, docs URL, request ID, issues) and the fixed exit codes.
- Destructive operations need `--yes`; at a terminal the CLI asks instead, and without one it refuses with `CONFIRMATION_REQUIRED` before calling Cloud.
- Secret inputs (a ClickHouse password, an OIDC client secret) come from stdin (`--password-stdin`) or a hidden prompt, never a flag value. New keys and signing keys are printed to stdout once, with a warning on stderr.

Telemetry records these invocations as one command, `cloud-operation`, without which operation ran.

Operations that grant access, create a credential or change authentication are confirmed like destructive ones, though Cloud does not require it: a prompt at a terminal, `--yes` otherwise (`--no-input`, CI, or `--json` without a terminal). They are `apiKeys.create`, `deployKeys.create`, `signingKeys.create`, `customerAccess.createKey`, `customerAccess.setMode`, `customerSettings.set`, `jwtIssuer.save`, `oidcClient.save`, `permissionSets.create`, `permissionSets.update`, `samplePolicy.set`, `connections.save`, `members.invite` and `org.setAccessPolicy`. A secret field inline in `--input-json` is refused (it would stay in shell history); use `--<field>-stdin`, `@<file>` or `-`. `--input-json @<file>` refuses a relative path that climbs out of the working directory and names an absolute path outside it on stderr. Cloud's error message, hint, docs URL, request ID and issues have control characters removed before they are printed.
