---
"@hypequery/cli": minor
---

New `hypequery check [file]` command. It loads your API, compiles representative queries for every dataset (each measure, each dimension including to-one relationship dimensions, and the time axis), and has ClickHouse or Postgres plan them with `EXPLAIN`, without executing anything. Failures name the field and quote the database's error, and the command exits 1, so it can gate CI. On Postgres it also warns about filtered sequential scans of large tables.

Telemetry records `check` as a command value with its flags (`--path`, `--database`, `--tenant`); no values are sent.
