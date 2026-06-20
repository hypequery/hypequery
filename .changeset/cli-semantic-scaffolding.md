---
"@hypequery/cli": minor
---

Add first-class semantic dataset scaffolding to the CLI.

- `hypequery init` can now scaffold either the query or dataset workflow, select
  ClickHouse tables, generate an API entrypoint, and optionally add a
  context-based authentication scaffold.
- Add `hypequery generate:datasets` for generating typed dataset definitions
  from an existing ClickHouse schema, with include/exclude table controls.
- Improve project discovery, generated ClickHouse type handling, prompts, and
  dependency installation for the new scaffold layouts.
