---
'@hypequery/gateway': minor
'@hypequery/studio': minor
'@hypequery/cli': minor
---

Add anonymous, opt-out usage telemetry to the experimental playground gateway. Telemetry is a no-op until an ingest endpoint is configured, prints a one-time disclosure on first enabled run, and never captures SQL, query names, inputs, results, or paths (machine UUID + hashed project id only; endpoint names hashed, durations bucketed). Opt out with `hypequery dev --no-telemetry`, `HYPEQUERY_TELEMETRY_DISABLED=1`, or `DO_NOT_TRACK=1`; it is also auto-disabled in CI.
