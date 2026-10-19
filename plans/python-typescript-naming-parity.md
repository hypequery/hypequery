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
Python now exports `serve_dev` to match the TypeScript function name, while
keeping `run_dev` available. Signatures remain specific to their runtimes. #600's runner stays the implementation behind the shared `dev`
CLI command.

## Verification

CLI regression tests cover both canonical names and compatibility aliases,
help without optional imports, both entrypoints, ambiguous init destinations,
flag forwarding into the runner, and real development server reload/shutdown.
Installed wheel/sdist checks use `init --path` and `help [command]` outside the
checkout, including base installations without serving dependencies.


## Public authoring parity follow-up

The Python authoring surface now exposes `dataset(...)`,
`dimension.string/number/boolean/timestamp()`, base `measure.sum/count/avg/...()`
helpers, `filter.eq/...()` and `order.asc/desc()`. Compound names follow Python
spelling, e.g. `measure.count_distinct` and `measure.arg_max`.
`create_memory_cache_store` matches TypeScript's `createMemoryCacheStore`.
Existing `Dataset(...)`, `dimension("string")`, `measure(sum("amount"))`, flat
filter/order/aggregation helpers, and `MemoryCacheStore(...)` remain valid.

These names expose implemented behavior. TypeScript-only capabilities such as
`publishDatasets`, `checkRelationships`, approximate distinct counts, and
shift/window/derived measures still need separate Python implementations;
there are no public stubs implying those features work. `create_dataset_client`,
`create_dataset_registry`, contract/catalog factories, `to_sql`, `for_tenant`
and `get_all` already follow the TypeScript names in Python spelling.


## Serving public API audit

Use current TypeScript public names in Python spelling where the roles match:

| TypeScript | Python | Role |
| --- | --- | --- |
| `createAPI` | `create_api` | Define authenticated API routing; Python accepts the same arguments as `create_router` |
| `createDatasetEndpoint` | `create_dataset_endpoint` | Construct a dataset endpoint; Python registration is `endpoint.install(api, path)` |
| `createMetricEndpoint` | `create_metric_endpoint` | Construct a one-measure metric endpoint; registration is separate |
| `serveDev` | `serve_dev` | Start the development runtime |
| `startServer` | `start_server` | Start the production runtime; Python requires a `ProductionProfile` |

`create_router`, `add_dataset_endpoint`, `add_metric_endpoint`, `run_dev` and
`run_production` remain available. The `add_*` helpers create and install the
endpoint in one step; the new `create_*` factories do not mutate routing.
`create_app` is the FastAPI adapter that converts the Python API router into
an ASGI application. It keeps its framework-specific name.

Do not port TypeScript `defineServe` as a preferred new function: it is
explicitly deprecated in favor of `createAPI` and standalone transport.
TypeScript's query/procedure builders (`initServe`, `query`, `serve`) have no
implemented Python equivalent. A name alias would imply behavior that is not
available.

Python `bearer_token` and `api_key` select credential transport; they do not
replace TypeScript `createBearerTokenStrategy` / `createApiKeyStrategy`, which
also implement authentication. Python supplies authentication separately via
`authenticate`. JWT strategies, Node/Fetch adapters and query-builder toolkit
exports are runtime-specific or unimplemented, not rename candidates.
Discovery retains `add_discovery_endpoint`: the TypeScript discovery factory
is used internally and is not re-exported by the public package index.
