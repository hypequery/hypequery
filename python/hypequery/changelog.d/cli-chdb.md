- `hypequery init --database chdb` scaffolds a project on embedded ClickHouse,
  as the TypeScript CLI does: the standalone or FastAPI app opens a chDB
  database directory (`--chdb-path`, default `analytics.chdb`) with no server
  or connection settings, and installs the `chdb` extra. An existing database
  is inspected like a server's; a new one gets the orders example and a
  seeding step. `hypequery generate datasets` reads the same database from
  `--chdb-path`, the path init records in `pyproject.toml`, or a project `analytics.chdb`
  when no ClickHouse server is configured, and says plainly when another
  process such as `hypequery dev` has the database open.
- `hypequery dev` serves a chDB project with reload, its default: the
  supervisor that checks the app before starting the worker now releases the
  app's database, since chDB holds a database directory for one process at a
  time (`run_dev(reload=True)` does the same; other chDB executors in the
  process stay open).
