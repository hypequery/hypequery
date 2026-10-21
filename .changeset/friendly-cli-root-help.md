---
"@hypequery/cli": patch
---

Display root help successfully when running `hypequery` without a command, including with `--no-telemetry`. This prints help to stdout, exits zero, and records a successful help event instead of `validation_failed`.
