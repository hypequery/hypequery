---
"@hypequery/cli": patch
---

Telemetry no longer counts running `hypequery` (or a command group such as `hypequery projects`) without a subcommand as a failed command. The help is recorded as shown; the exit code is still 1.
