- `hypequery init --tenant-column` records the column in `schema.json`, and
  `hypequery generate datasets` reuses it unless given `--tenant-column` or the
  new `--no-tenant-column`. Regenerating without repeating the flag used to
  drop every `tenant_key`. An unusable recorded value is refused before
  discovery rather than read as no tenant column.
- A strict client endpoint's `400 Invalid client query.` now carries
  `details.issues[].path`, the member or item that failed (for example
  `["filters", 0, "value"]`), as the README promised. Paths name contract
  members and indexes only; an unknown member is reported at the root, and no
  submitted value is echoed.
- Scaffolds discovered as a user other than `default` no longer suggest
  `CLICKHOUSE_USERNAME=default` in `.env.example` and the README, which would
  quietly connect as a different, usually broader, user. They show a
  placeholder; the real name stays out of generated files, like the password.
- `to_asgi_app` and `to_wsgi_app` log one warning on `hypequery.serve` when
  served below a `root_path` or `SCRIPT_NAME` that differs from
  `client_mount_path`, naming the setting. Contract paths still never follow a
  prefix the server or a proxy reports.
- Docs: a query mapping passed to `client.execute` uses `DatasetQuery`'s field
  names (`order_by`, not the HTTP wire's `orderBy`); every scaffold README
  (standalone, Django and Flask, offline or from your schema) says timeouts
  need `SELECT ON system.processes` or a control user; a synchronous
  caller gets `deadline-exceeded` only once ClickHouse stops the query.
