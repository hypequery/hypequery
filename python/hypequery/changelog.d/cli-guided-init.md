- `hypequery init` is guided in a terminal, as the TypeScript CLI is. It asks
  for whatever its flags leave unset: where to create the project; how to
  reach ClickHouse (the connection already in your environment, or a URL and
  credentials typed in, with the password hidden, used only to read the schema
  and never written to a file); which tables, when the database has more than
  ten; the tenant column, when one looks like a tenant id; and which app to
  scaffold, defaulting to FastAPI, Django or Flask when it finds one. A failed
  connection offers to try again, change the details, or create the offline
  example. It ends with the same choices as flags. Every flag answers its
  question, and `--no-interactive`, a `CI` environment variable, or input that
  is not a terminal skip the questions and keep the previous behavior.
- The `hypequery` CLI loads `.env.local` and `.env` from the directory it runs
  in, as the TypeScript CLI does. A variable already set wins over both files.
  The library and generated apps still read only the real environment;
  `hypequery.cli.load_env_files(directory)` applies the same rules in your own
  scripts, such as the scaffold README's seed step.
- When init can't reach ClickHouse, the message names `CLICKHOUSE_URL` as well
  as the host settings and suggests `--skip-connection`, and the driver's own
  "Unexpected Http Driver Exception" log line no longer reaches the terminal.
- `hypequery init --framework fastapi` scaffolds a FastAPI `app.py`: the
  bearer-token agents API mounted at `/api/agents`, and `/analytics/<dataset>`,
  a route of your own that refuses everyone until its `current_principal`
  dependency reads your login. The project depends on `fastapi` directly;
  hypequery adds no FastAPI extra.
