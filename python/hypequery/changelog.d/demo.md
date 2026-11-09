- `hypequery demo`: a sample semantic layer on embedded ClickHouse, served to
  an AI agent over MCP stdio with no server, configuration or network. With
  only uv installed, `uvx --from "hypequery[chdb,mcp]" hypequery demo` seeds a
  two-tenant shop in a temporary chDB database (deleted on exit) and serves its
  `orders`, `events` and `daily_activity` datasets. `--self-test` prints the
  answers in the terminal, each beside the read a naive query gets: plain
  reads of a ReplacingMergeTree against `resolved_rows.replacing()`,
  `count_distinct` against `approx_count_distinct`, `merge("uniq")` over an
  AggregatingMergeTree against summed daily counts, and `measure.shift` and
  `measure.trailing` results. `--print-config` prints an `mcpServers` entry
  and `--tenant` picks the tenant the agent is signed in as.
