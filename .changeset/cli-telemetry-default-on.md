---
"@hypequery/cli": minor
---

Enable CLI telemetry by default. Unless opted out, the CLI now sends pseudonymous usage events to Hypequery's first-party endpoint (`https://hypequery.com/api/telemetry`) without needing `HYPEQUERY_TELEMETRY_URL`, which now only overrides the endpoint for staging or self-hosting. Events never include code, SQL, names, paths or credentials; see https://hypequery.com/docs/telemetry for every field. A one-time notice appears on the first interactive run. Opt out with `hypequery telemetry disable`, `--no-telemetry`, `DO_NOT_TRACK=1` or `HYPEQUERY_TELEMETRY_DISABLED=1`.
