"""Render a runnable project from schema-backed dataset definitions."""

from __future__ import annotations

import json
import shlex

from ..utils.connection_scaffold import export_lines, replace_env_block
from .datasets import GeneratedDatasets
from .framework_apps import (
    APP_MODULE,
    EXTRAS,
    Framework,
    django_module,
    flask_module,
    readme_section,
)
from .schema import Schema


def schema_templates(
    templates: dict[str, str],
    schema: Schema,
    generated: GeneratedDatasets,
    framework: Framework = "fastapi",
) -> dict[str, str]:
    result = templates.copy()
    result.pop("seed.sql")
    module = APP_MODULE[framework]
    result["pyproject.toml"] = (
        templates["pyproject.toml"]
        .replace('py-modules = ["app"]', f'py-modules = ["{module}", "datasets"]')
        .replace("hypequery[server,clickhouse]", f"hypequery[{EXTRAS[framework]}]")
    )
    result["datasets.py"] = generated.source
    result["schema.json"] = generated.snapshot
    result["app.py"] = """import os
import secrets

from datasets import datasets
from hypequery.datasets import create_dataset_client, create_dataset_registry
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor
from hypequery.serve import (
    Credential, HttpSecurity, Principal, create_api, create_dataset_endpoint, to_asgi_app,
)

DEV_TOKEN = os.environ["HYPEQUERY_DEV_TOKEN"]
if not DEV_TOKEN:
    raise ValueError("HYPEQUERY_DEV_TOKEN must not be empty")

# Reads CLICKHOUSE_URL, or CLICKHOUSE_HOST, _PORT, _DATABASE, _USERNAME, _PASSWORD and _SECURE.
executor = create_clickhouse_executor(ClickHouseConnection.from_env())
registry = create_dataset_registry(*datasets.values())
client = create_dataset_client(executor=executor, registry=registry)


def authenticate(credential: Credential) -> Principal | None:
    if secrets.compare_digest(credential.value, DEV_TOKEN):
        return Principal(subject="developer")
    return None


api = create_api(
    auth=authenticate,
    security=HttpSecurity(allowed_hosts=("127.0.0.1", "localhost")),
    development_docs=True,
)
for name, definition in datasets.items():
    endpoint = create_dataset_endpoint(dataset=definition, client=client)
    endpoint.install(api, f"/datasets/{name}/query")

app = to_asgi_app(api)
"""
    result[".env.example"] = replace_env_block(
        templates[".env.example"], schema.connection, schema.database
    )
    prefix = templates["README.md"].split("## Create sample data", 1)[0]
    template_exports = "\n".join(
        (
            "export CLICKHOUSE_HOST=localhost",
            "export CLICKHOUSE_PORT=8123",
            "export CLICKHOUSE_DATABASE=default",
            "export CLICKHOUSE_USERNAME=default",
            "export CLICKHOUSE_PASSWORD='your-local-password'",
        )
    )
    if template_exports not in prefix:
        raise ValueError("README template no longer has the expected export block")
    prefix = prefix.replace(
        template_exports, "\n".join(export_lines(schema.connection, schema.database))
    )
    regenerate = " ".join(
        part
        for part in (
            "hypequery generate datasets",
            f"--tables {shlex.quote(generated.selection['tables'])}"
            if "tables" in generated.selection
            else "",
            f"--exclude-tables {shlex.quote(generated.selection['excludeTables'])}"
            if "excludeTables" in generated.selection
            else "",
            f"--tenant-column {shlex.quote(generated.tenant_column)}"
            if generated.tenant_column
            else "",
        )
        if part
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
    run_section = (
        f"""## Run and query

Use the same connection settings as schema discovery. No seed data is needed;
this project queries your existing tables. Start the server with `hypequery dev`.

```bash
curl -s -X POST http://127.0.0.1:8000/datasets/{generated.tables[0]}/query \\
  -H "Authorization: Bearer $HYPEQUERY_DEV_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{payload}'
```
"""
        if framework == "fastapi"
        else readme_section(framework, generated.tables[0])
    )
    if framework != "fastapi":
        result.pop("app.py")
        result[f"{module}.py"] = (
            django_module(generated.tenant_column)
            if framework == "django"
            else flask_module(generated.tenant_column)
        )
        result[".env.example"] = result[".env.example"].replace("HYPEQUERY_DEV_TOKEN=\n", "")
        prefix = (
            prefix.replace(
                "Export your\nconnection settings and create a development token in your shell:",
                "Export your\nconnection settings in your shell:",
            )
            .replace(
                "export HYPEQUERY_DEV_TOKEN=\"$(python -c 'import secrets; "
                "print(secrets.token_urlsafe(32))')\"\n",
                "",
            )
            .replace("[server,clickhouse]", f"[{EXTRAS[framework]}]")
            .replace(
                "Do not commit credentials. The token is for local development; use your real\n"
                "authentication and a production profile before exposing the app to users.",
                "Do not commit credentials.",
            )
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

{run_section}
After schema changes, inspect drift with `{regenerate} --diff`
(exit 1 when different). Use `--check` in CI and `--force` to replace
definitions after reviewing the diff. The table selection given to init is
recorded in `schema.json` and reused; pass `--all-tables` to drop it. Pass
`--tenant-column <column>` on every regeneration to keep a `tenant_key` boundary.
With a `tenant_key`, the tenant column also stays a dimension: tenant-scoped
queries only ever see their own value, and cross-tenant analysis
(`all_tenants()`) can still group by it.
Regeneration replaces the whole definitions file, including custom measures and
relationships. Review the diff first, or generate to a separate file and merge
changes manually.
`schema.json` records discovery at init time and is not refreshed by regeneration.
Keep hand-written changes (relationships, custom measures) out of the generated
file: regenerate into a separate module with `--output`, or review `--diff`
before `--force`. `--output` also lets you choose a module name other than
`datasets.py` if it collides with an installed package such as Hugging Face's
`datasets`.
Credentials are read from the
environment at runtime; neither schema snapshots nor definitions contain them.
"""
    )
    return result
