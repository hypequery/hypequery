"""Render a runnable project from schema-backed dataset definitions."""

from __future__ import annotations

import json

from .datasets import GeneratedDatasets
from .schema import Schema

_POSTGRES_ENV = """# Reference only: export these in your shell. This file is not auto-loaded.
# A postgres:// URL; the role needs USAGE on the schema and SELECT on its tables.
HYPEQUERY_POSTGRES_URL=postgresql://user:password@localhost:5432/database
HYPEQUERY_DEV_TOKEN=
"""

_POSTGRES_README = """# Your Python dataset project

Requires Python 3.11+ and an existing Postgres database. No Node tools are needed.
The generated `pyproject.toml` pins the SDK version used to scaffold this project.

## Install

From this generated project directory, create an environment and install the
project. This installs the pinned SDK from PyPI with the serving and Postgres
extras:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

If you scaffolded with an unreleased SDK build, install that wheel first, then
the project without dependencies:

```bash
python -m pip install "/path/to/hypequery-__HYPEQUERY_VERSION__-py3-none-any.whl[fastapi,postgres]"
python -m pip install -e . --no-deps
```

## Configure

`.env.example` is a reference; it is **not loaded automatically**. Export your
connection URL and create a development token in your shell:

```bash
export HYPEQUERY_POSTGRES_URL='postgresql://user:password@localhost:5432/database'
export HYPEQUERY_DEV_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
```

Each query runs in a read-only transaction with a statement timeout. Do not
commit credentials. The token is for local development; use your real
authentication and a production profile before exposing the app to users.

"""


def schema_templates(
    templates: dict[str, str], schema: Schema, generated: GeneratedDatasets
) -> dict[str, str]:
    postgres = schema.engine == "postgres"
    result = templates.copy()
    result.pop("seed.sql")
    result["pyproject.toml"] = templates["pyproject.toml"].replace(
        'py-modules = ["app"]', 'py-modules = ["app", "datasets"]'
    )
    if postgres:
        result["pyproject.toml"] = result["pyproject.toml"].replace(
            "hypequery[fastapi,clickhouse]", "hypequery[fastapi,postgres]"
        )
    result["datasets.py"] = generated.source
    result["schema.json"] = generated.snapshot
    result["app.py"] = """import os
import secrets

from datasets import datasets
from hypequery.datasets import create_dataset_client, create_dataset_registry
__EXECUTOR_IMPORT__
from hypequery.serve import (
    Credential, HttpSecurity, Principal, create_api, create_app, create_dataset_endpoint,
)

DEV_TOKEN = os.environ["HYPEQUERY_DEV_TOKEN"]
if not DEV_TOKEN:
    raise ValueError("HYPEQUERY_DEV_TOKEN must not be empty")

__EXECUTOR__
registry = create_dataset_registry(*datasets.values())
client = create_dataset_client(executor=executor, registry=registry)


def authenticate(credential: Credential) -> Principal | None:
    if secrets.compare_digest(credential.value, DEV_TOKEN):
        return Principal(subject="developer")
    return None


api = create_api(authenticate=authenticate)
for name, definition in datasets.items():
    endpoint = create_dataset_endpoint(dataset=definition, client=client)
    endpoint.install(api, f"/datasets/{name}/query")

app = create_app(
    api,
    security=HttpSecurity(allowed_hosts=("127.0.0.1", "localhost")),
    development_docs=True,
)
"""
    if postgres:
        executor_import = (
            "from hypequery.execution import PostgresConnection, create_postgres_executor"
        )
        executor = (
            "# Reads HYPEQUERY_POSTGRES_URL (or DATABASE_URL).\n"
            "executor = create_postgres_executor(PostgresConnection.from_env())"
        )
    else:
        executor_import = (
            "from hypequery.execution import ClickHouseConnection, create_clickhouse_executor"
        )
        executor = (
            "# Reads CLICKHOUSE_HOST, _PORT, _DATABASE, _USERNAME, _PASSWORD and _SECURE.\n"
            "executor = create_clickhouse_executor(ClickHouseConnection.from_env())"
        )
    result["app.py"] = (
        result["app.py"]
        .replace("__EXECUTOR_IMPORT__", executor_import)
        .replace("__EXECUTOR__", executor)
    )
    if postgres:
        result[".env.example"] = _POSTGRES_ENV
        prefix = _POSTGRES_README
    else:
        result[".env.example"] = templates[".env.example"].replace(
            "CLICKHOUSE_DATABASE=default", f"CLICKHOUSE_DATABASE={schema.database}"
        )
        prefix = templates["README.md"].split("## Create sample data", 1)[0]
        prefix = prefix.replace(
            "export CLICKHOUSE_DATABASE=default", f"export CLICKHOUSE_DATABASE={schema.database}"
        )
    payload = json.dumps(
        {
            "dimensions": [generated.first_dimension],
            "measures": [generated.first_count_measure],
            "limit": 10,
        }
    )
    report = (
        "\n".join(f"- {warning}" for warning in generated.warnings)
        or "No unsupported columns or ambiguous time keys were found."
    )
    result["README.md"] = (
        prefix
        + f"""## Generated datasets

The CLI inspected `{schema.database}` without modifying the database.
`datasets.py` contains definitions for {", ".join(generated.tables)}; `schema.json`
records the exact source column names/types and generation warnings.
Physical names are mapped explicitly to the same camelCase semantic field names
as the TypeScript CLI. `totalCount` counts each table's first non-nullable
column, which is a row count. If no supported non-nullable column is available,
the CLI generates `nonNullCount` instead and reports a warning. It counts the
first supported column's non-null values, not every row; `totalCount` is omitted.
Numeric sum/average measures are suggestions: review their business semantics.
IDs and coordinates remain dimensions. Relationships and tenant boundaries are
not inferred; configure them explicitly before exposing this API.

### Review notes

{report}

## Run and query

Use the same connection settings as schema discovery. No seed data is needed;
this project queries your existing tables. Start the server with `hypequery dev`.

```bash
curl -s -X POST http://127.0.0.1:8000/datasets/{generated.tables[0]}/query \\
  -H "Authorization: Bearer $HYPEQUERY_DEV_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{payload}'
```

After schema changes, inspect drift with
`hypequery generate datasets --diff` (exit 1 when different).
Use `--check` in CI and `--force` to replace definitions after reviewing the diff.
Repeat the original `--tables` / `--exclude-tables` selection when regenerating,
and pass `--tenant-column <column>` to keep a `tenant_key` boundary.
Regeneration replaces the whole definitions file, including custom measures and
relationships. Review the diff first, or generate to a separate file and merge
changes manually.
`schema.json` records discovery at init time and is not refreshed by regeneration.
Credentials are read from the
environment at runtime; neither schema snapshots nor definitions contain them.
"""
    )
    return result
