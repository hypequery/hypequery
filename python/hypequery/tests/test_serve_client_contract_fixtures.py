"""Language-neutral client-contract fixtures: the export and its schema pin.

TypeScript's `createAPI` runs the same file; both must export the same
contract for the same definition and answer pinned requests alike.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from hypequery.datasets import (
    ClientQueryProfile,
    CompiledQuery,
    Dataset,
    DatasetLimits,
    FilterDefinition,
    create_dataset_client,
    dimension,
    measure,
)
from hypequery.datasets.client import ResultScalar
from hypequery.datasets.formulas import divide
from hypequery.serve import (
    Credential,
    HttpSecurity,
    Principal,
    create_api,
    create_dataset_endpoint,
    create_metric_endpoint,
    export_client_contract,
)
from serve_transports import TRANSPORTS, serve_client

FIXTURES = json.loads(
    (
        Path(__file__).resolve().parents[3]
        / "specs/serve-http/fixtures/client-contract-v1/cases.json"
    ).read_text()
)
APP = FIXTURES["app"]


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


class Executor:
    def execute(self, compiled: CompiledQuery) -> Rows:
        columns = tuple(re.findall(r" AS `([^`]+)`", compiled.sql.split(" FROM ", 1)[0]))
        match = re.search(r"LIMIT (\d+)(?: OFFSET (\d+))?$", compiled.sql)
        assert match
        rows = APP["rows"][int(match[2] or 0) :][: int(match[1])]
        return Rows(columns, tuple(tuple(row[column] for column in columns) for row in rows))


def fixture_dataset() -> Dataset:
    """The fixture dataset, authored as TypeScript's test authors it."""

    source = APP["dataset"]
    dimensions = {
        name: getattr(dimension, field["type"])(
            **{key: field[key] for key in ("column", "label", "groupable") if key in field}
        )
        for name, field in source["dimensions"].items()
    }
    measures = {
        name: measure.derived(divide(*definition["divide"]))
        if "divide" in definition
        else getattr(measure, definition["aggregation"])(
            definition["field"],
            **({"description": definition["description"]} if "description" in definition else {}),
        )
        for name, definition in source["measures"].items()
    }
    filters = {
        name: FilterDefinition(
            field=definition["field"],
            operators=tuple(definition["operators"]) if "operators" in definition else None,
        )
        for name, definition in source["filters"].items()
    }
    return Dataset(
        name=source["name"],
        source=source["source"],
        description=source["description"],
        time_key=source["timeKey"],
        time_grains=tuple(source["timeGrains"]),
        dimensions=dimensions,
        measures=measures,
        filters=filters,
        limits=DatasetLimits(
            max_result_size=source["limits"]["maxResultSize"],
            max_measures=source["limits"]["maxMeasures"],
        ),
    )


def fixture_api() -> Any:
    def authenticate(credential: Credential) -> Principal | None:
        return Principal(subject="alice") if credential.value == APP["credential"] else None

    dataset = fixture_dataset()
    client = create_dataset_client(executor=Executor())
    metric = APP["metric"]
    return create_api(
        auth=authenticate,
        security=HttpSecurity(allowed_hosts=("testserver",)),
        base_path=APP["basePath"],
        client_mount_path=APP["mountPath"],
        datasets={
            dataset.name: create_dataset_endpoint(
                dataset=dataset, client=client, client_profile=ClientQueryProfile()
            )
        },
        metrics={
            metric["name"]: create_metric_endpoint(
                dataset=dataset,
                measure=metric["measure"],
                name=metric["name"],
                client=client,
                client_profile=ClientQueryProfile(),
            )
        },
    )


def test_export_matches_the_shared_contract() -> None:
    exported = export_client_contract(fixture_api())
    assert exported["canonical"] == FIXTURES["contract"]["canonical"]
    assert exported["contentHash"] == FIXTURES["contract"]["contentHash"]


def schema_hash(path: str) -> str:
    contract = json.loads(FIXTURES["contract"]["canonical"])
    return str(
        next(
            endpoint["schemaHash"]
            for endpoint in contract["endpoints"]
            if endpoint["path"] == APP["mountPath"] + path
        )
    )


@pytest.mark.parametrize("case", FIXTURES["cases"], ids=[case["id"] for case in FIXTURES["cases"]])
@pytest.mark.parametrize("transport", TRANSPORTS)
def test_client_contract_v1(case: dict[str, Any], transport: str) -> None:
    headers: dict[str, str] = {}
    if case["credential"] == "valid":
        headers["Authorization"] = "Bearer " + APP["credential"]
    if "pin" in case:
        pin = case["pin"]
        headers["X-Hypequery-Client-Schema"] = (
            schema_hash(case["path"]) if pin == "current" else pin
        )
    response = serve_client(transport, fixture_api()).request(
        "POST", case["path"], headers=headers, json=case["json"]
    )
    body = response.json()
    expected = case["expect"]
    assert response.status_code == expected["status"], response.text
    if "data" in expected:
        assert body["data"] == expected["data"]
    if expected.get("meta") is False:
        assert "meta" not in body
    elif "meta" in expected:
        assert set(body["meta"]) <= {"requestId", "timingMs", "rowCount", "pagination", "cache"}
        assert body["meta"]["rowCount"] == expected["meta"]["rowCount"]
        assert body["meta"]["pagination"] == expected["meta"]["pagination"]
        assert body["meta"]["requestId"]
    if "error" in expected:
        for key, value in expected["error"].items():
            assert body["error"][key] == value
