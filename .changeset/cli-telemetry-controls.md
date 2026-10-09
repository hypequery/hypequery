---
"@hypequery/cli": minor
---

Add persistent telemetry preferences, `hypequery telemetry status|enable|disable`, and a global `--no-telemetry` flag. Honor `DO_NOT_TRACK=1`, `HYPEQUERY_TELEMETRY_DISABLED=1`, and test environments. Default collection remains inactive; maintainers can activate the staged core with `HYPEQUERY_TELEMETRY_DEBUG=1` or `HYPEQUERY_TELEMETRY_URL`.

Define the v1 event catalog (command completion and crash events) with strict property validation, bucketed measurements, and a generated public event reference that lists only data the CLI sends. Unknown fields and content-bearing values are rejected before a payload can be constructed.

Add pseudonymous identity, local environment context, a one-time stderr disclosure, dependency-free bounded batch delivery, debug inspection, a per-version kill switch, and centralized command exit handling. Preserve command output and exit codes when telemetry is disabled or fails. No telemetry runtime dependency is added.

Instrument the `init` onboarding funnel in staged mode with progress, failure stages, scaffold choices, bucketed counts, and configuration-file outcomes. Preserve a single completion event across retries and classify early setup declines as cancellations. Honor Commander's `--no-example` option when scaffolding.
