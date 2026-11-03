- `hypequery init --database chdb` scaffolds a project on embedded ClickHouse,
  as the TypeScript CLI does: the standalone or FastAPI app opens a chDB
  database directory (`--chdb-path`, default `analytics.chdb`) with no server
  or connection settings, and installs the `chdb` extra. An existing database
  is inspected like a server's; a new one gets the orders example and a
  seeding step. `hypequery generate datasets` reads the same database from
  `--chdb-path`, the path init records in `pyproject.toml`, or a project `analytics.chdb`
  when no ClickHouse server is configured, and says plainly when another
  process such as `hypequery dev` has the database open.
