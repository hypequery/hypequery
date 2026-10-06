# Python / TypeScript naming audit

Reviewed the open Python beta PRs on 6 October 2026: #591, #600, #601,
#602, #606–#609 and #610, plus the TypeScript HAVING counterpart #597.

## CLI contract

Use shared names for shared commands and options:

| TypeScript | Python beta | Compatibility |
| --- | --- | --- |
| `init --path <directory>` | `init --path <directory>` | Python also accepts `init [directory]` |
| `dev --hostname <host>` | `dev --hostname <host>` | Python also accepts `--host` |
| `dev -p` / `--port` | `dev -p` / `--port` | Same spelling |
| `dev --no-watch` | `dev --no-watch` | Python also accepts `--no-reload` |
| `-V` / `--version` | `-V` / `--version` | Same spelling |
| `help [command]` | `help [init\|dev]` | Python supports the beta commands |

Python retains `-h` for argparse help. The TypeScript dev command uses `-h`
for hostname; use the common long form `--hostname` across languages.
Python accepts a `module:attribute` entrypoint and defaults to `app:app`;
TypeScript accepts a file. Python defaults to the current scaffold directory
and `127.0.0.1:8000`. These are runtime-specific defaults, not naming aliases.
The Python runner API and its standalone module retain `host`/`reload`.

## Dataset API and wire names

Python functions follow `snake_case`; exported model classes use PascalCase.
Do not introduce camelCase Python aliases merely to copy JavaScript spelling.

| TypeScript | Python | Status |
| --- | --- | --- |
| `createDatasetClient` | `create_dataset_client` | Existing canonical factories |
| `belongsTo`, `hasMany`, `hasOne` | `belongs_to`, `has_many`, `has_one` | Same relationships |
| `RelationshipKey` with `from` / `to` | `RelationshipKey` with `from_field` / `to_field` | #591 / #602; `from` is a Python keyword |
| composite `keys` | composite `keys` | #591 / #602 |
| `inList`, `notInList` | `in_list`, `not_in_list` | Existing filter helpers |
| `DatasetHavingCondition` | `HavingCondition` | #597 / #602; Python omits the dataset prefix inside its datasets module |
| `having`, `measure`, `operator`, `value` | Same spellings | #597 / #602 |
| weekly bucket `week` | weekly bucket `week` | #610; Monday start in both |

HTTP and serialized protocol names retain shared wire spelling, including
`orderBy`, `notIn`, `belongsTo`, and relationship `from`/`to`. Local Python
identifiers do not change these contracts. Relationship-qualified dimensions
and measures use the same `<relationship>.<name>` notation.

The serving runtimes are not API-identical: TypeScript `serveDev` integrates
its HTTP server, while Python `run_dev` starts Uvicorn for an ASGI application.
Retain the established runtime names rather than implying interchangeable
signatures. #600's runner stays the implementation behind the shared `dev`
CLI command.

## Verification

CLI regression tests cover both canonical names and compatibility aliases,
help without optional imports, both entrypoints, ambiguous init destinations,
flag forwarding into the runner, and real development server reload/shutdown.
Installed wheel/sdist checks use `init --path` and `help [command]` outside the
checkout, including base installations without serving dependencies.
