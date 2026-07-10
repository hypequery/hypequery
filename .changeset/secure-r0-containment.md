---
"@hypequery/clickhouse": patch
"@hypequery/serve": patch
"@hypequery/cli": patch
---

Harden logging and diagnostics without changing public APIs: never mark
authenticated or tenant-aware responses as publicly cacheable, log the
parameterized SQL template instead of a value-substituted string, and redact
connection URLs in CLI output and error messages.
