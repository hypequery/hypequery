---
"@hypequery/cli": patch
---

Telemetry now attributes an invocation that Commander rejects for a bad option or argument (for example `hypequery dev --bogus`) to the command that was requested, instead of reporting it as `unknown`. Mistyped commands are still `unknown`, now with an optional `suggested_command` taken from the CLI's own "Did you mean" suggestion; the raw input is never recorded.
