# CLI telemetry event contract v1

Implements the event specification in HQ-231 and the catalog/validation boundary
in HQ-243. The telemetry core and `init` onboarding instrumentation are available
in debug or explicitly configured ingest mode. Default collection is inactive;
the ingest proxy and rollout remain separate work.

## Source of truth

`packages/cli/src/utils/telemetry/catalog.ts` defines the five event names, the
question each event answers, common fields, per-command/session variants and the
question each field answers. `domains.ts` and `value-formats.ts` define their closed
value domains. Event schema versioning is independent of the preferences file's
schema version.

`createTelemetryEvent` is the typed construction boundary. It rejects undeclared
root, property and nested record keys at compile time, including on variables.
It validates runtime values, creates a detached JSON snapshot and validates that
snapshot again. Invalid events return null. `validateTelemetryEvent` is available
for an untrusted payload, including future ingestion validation. Transport must
validate again before sending; validating once does not make mutable data safe.

## Events and cardinality

- `cli_command_completed`: exactly once per invocation, including help/version
  and unknown-command failures. Its command discriminant restricts properties and
  flags to that command. Never emit for `telemetry disable`.
- `cli_session_started` and `cli_session_ended` (planned): dev/MCP configuration
  and aggregated shutdown counters. No individual reloads, requests or tool calls.
- `cli_crash`: only a built-in exception-class enum and a stable error code.
  Custom classes become unknown; messages, stacks and error objects are forbidden.
- `project_features` (planned): aggregates from a module the command already loaded.
  Never load user code just for telemetry. Future instrumentation must deduplicate
  this event by project ID and day, at most once per project per day.

The catalog, and the public reference generated from it, contains only events
and command properties the CLI emits. Planned events and each command's
completion properties join the catalog in the change that instruments them, so
the published reference never describes collection that does not happen.

All events contain the common environment/identity fields. Package versions are
restricted to the shipped package-name allowlist and exact numeric release versions;
file, git and registry dependency specifications must never be forwarded. Unknown
details become the documented unknown enum/format or an omitted optional field.
Collectors must supply genuine generated identities: syntactic format validation
cannot prove that a UUID was random or a hash was derived by the approved algorithm.

## Privacy decisions

- Count buckets are 0, 1, 2–5, 6–20, 21–100, and 101 or more. The final label is
  `101+` to remove the overlap in the ticket's shorthand `100+`.
- Durations use `duration_bucket`, replacing the draft `duration_ms` field with
  the project's required bucketed form. Boundaries are 100ms, 1s, 10s, 1m, 10m
  and 1h; lower bounds are inclusive and upper bounds exclusive.
- Bundle sizes use binary units with boundaries 10KiB, 100KiB, 1MiB and 10MiB,
  plus zero. Invalid measurements are omitted, not coerced into a bucket.
- Canonical flag names are allowlisted per command. Values, positional arguments,
  unknown flag names and tokens after `--` are discarded. Type-generation aliases
  remain distinct command values. Unknown commands/topics become `unknown`.
- Auth strategies are callable user code, so their identity is only
  `none|configured|unknown`. Cache scopes are user strings; classify configuration
  as `unscoped|tenant|explicit|unknown` without collecting scope values.
- MCP handshake client names/versions are excluded pending HQ-247's privacy
  decision. No user names, paths, SQL, table/column/dataset names, hosts,
  tenant IDs, Cloud account IDs, credentials, messages or stacks are allowed.
- Follow HQ-233: customer CI and non-TTY are eligible under the preferences;
  notice display is independent. The CLI uses a shared global project-hash salt,
  and the ingest proxy must HMAC-re-key the hash before storage. No git remote:
  hash the workspace root package name; no signal: omit project ID. The installed
  preferences do not need a per-install salt. Do not link installs to Cloud users.

## Review and generated reference

Run `pnpm --filter @hypequery/cli telemetry:docs` to update the generated section
of `website-next/docs/telemetry.mdx`, or `telemetry:docs:check` to check drift.
The unit suite checks the generated page against the catalog and snapshots the
catalog and format rules. Turbo includes that docs file in the CLI test inputs.
Type tests run with CLI tests and cover exact payloads and command variants.

The privacy suite injects content sentinels into every declared field and nested
record across all event variants. Future command instrumentation must additionally
exercise actual command paths with sentinels; these schema tests do not claim to
cover command integrations that are not implemented yet.

New fields/events need a stated question, a closed value domain, tests, a snapshot
review and docs regeneration. Bump the event schema version for breaking changes;
never reuse an event name with a different meaning. Privacy/legal review and the
backend's retention/deletion policies remain rollout prerequisites (HQ-229/HQ-254).
