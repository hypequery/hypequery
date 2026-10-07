"""Render a runnable project from schema-backed dataset definitions."""

from __future__ import annotations

import json

from .datasets import GeneratedDatasets
from .schema import Schema


def schema_templates(
    templates: dict[str, str], schema: Schema, generated: GeneratedDatasets
) -> dict[str, str]:
    result = templates.copy()
    result.pop("seed.sql")
    result["pyproject.toml"] = templates["pyproject.toml"].replace(
        'py-modules = ["app"]', 'py-modules = ["app", "datasets"]'
    )
    result["datasets.py"] = generated.source
    result["schema.json"] = generated.snapshot
    result["app.py"] = """import os
import secrets

from datasets import datasets
from hypequery.datasets import create_dataset_client, create_dataset_registry
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor
from hypequery.serve import (
    Credential, HttpSecurity, Principal, create_api, create_app, create_dataset_endpoint,
)

DEV_TOKEN = os.environ["HYPEQUERY_DEV_TOKEN"]
if not DEV_TOKEN:
    raise ValueError("HYPEQUERY_DEV_TOKEN must not be empty")

executor = create_clickhouse_executor(ClickHouseConnection(
    host=os.environ.get("CLICKHOUSE_HOST", "localhost"),
    port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
    database=os.environ.get("CLICKHOUSE_DATABASE", "default"),
    username=os.environ.get("CLICKHOUSE_USERNAME", "default"),
    password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
    secure=os.environ.get("CLICKHOUSE_SECURE", "false").lower() == "true",
))
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
    result[".env.example"] = templates[".env.example"].replace(
        "CLICKHOUSE_DATABASE=default", f"CLICKHOUSE_DATABASE={schema.database}"
    )
    prefix = templates["README.md"].split("## Create sample data", 1)[0]
    prefix = prefix.replace(
        "export CLICKHOUSE_DATABASE=default", f"export CLICKHOUSE_DATABASE={schema.database}"
    )
    payload = json.dumps(
        {"dimensions": [generated.first_dimension], "measures": ["totalCount"], "limit": 10}
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
as the TypeScript CLI. `totalCount` counts rows, including nullable columns.
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
Repeat the original `--tables` / `--exclude-tables` selection when regenerating.
Regeneration replaces the whole definitions file, including custom measures,
relationships and any `tenant_key` you configured. Review the diff first, or
generate to a separate file and merge changes manually.
`schema.json` records discovery at init time and is not refreshed by regeneration.
Credentials are read from the
environment at runtime; neither schema snapshots nor definitions contain them.
"""
    )
    return result
