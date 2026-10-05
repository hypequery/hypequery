"""Language-neutral semantic HTTP fixtures against Python's ASGI app."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from hypequery.datasets import (
    CompiledQuery,
    Dataset,
    DatasetLimits,
    count,
    create_dataset_client,
    create_dataset_registry,
    dimension,
    measure,
)
from hypequery.datasets.client import ResultScalar
from hypequery.serve import (
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_dataset_endpoint,
    add_discovery_endpoint,
    add_metric_endpoint,
    create_app,
    create_router,
)

FIXTURES = json.loads(
    (
        Path(__file__).resolve().parents[3] / "specs/serve-http/fixtures/semantic-v1/cases.json"
    ).read_text()
)


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


class Executor:
    def execute(self, compiled: CompiledQuery) -> Rows:
        columns = tuple(re.findall(r" AS `([^`]+)`", compiled.sql))
        match = re.search(r"LIMIT (\d+)(?: OFFSET (\d+))?$", compiled.sql)
        assert match
        rows = FIXTURES["app"]["rows"][int(match[2] or 0) :][: int(match[1])]
        return Rows(columns, tuple(tuple(row[column] for column in columns) for row in rows))


def app(case: dict[str, Any]) -> TestClient:
    config = FIXTURES["app"]
    dataset = Dataset(
        name=config["dataset"],
        source=config["source"],
        tenant_key="private_tenant" if case.get("tenantRequired") else None,
        dimensions={config["dimension"]: dimension("string", column=config["column"])},
        measures={config["measure"]: measure(count(config["measureField"]))},
        limits=DatasetLimits(max_result_size=config["maxLimit"]),
    )

    def authenticate(credential: Credential) -> Principal | None:
        if credential.value != config["credential"]:
            return None
        principal = case.get("principal", {})
        return Principal(
            subject="alice",
            roles=frozenset(principal.get("roles", [])),
            scopes=frozenset(principal.get("scopes", [])),
            tenant_id=principal.get("tenantId"),
        )

    router = create_router(authenticate=authenticate)
    client = create_dataset_client(executor=Executor())
    policy = EndpointPolicy(
        tenant="required" if case.get("tenantRequired") else "optional",
        required_roles=frozenset(case.get("requiredRoles", [])),
        required_scopes=frozenset(case.get("requiredScopes", [])),
    )
    add_dataset_endpoint(
        router,
        f"/datasets/{config['dataset']}/query",
        dataset=dataset,
        client=client,
        policy=policy,
    )
    add_metric_endpoint(
        router,
        f"/metrics/{config['measure']}",
        dataset=dataset,
        measure=config["measure"],
        client=client,
        policy=policy,
    )
    add_discovery_endpoint(router, registry=create_dataset_registry(dataset), policy=policy)
    return TestClient(create_app(router, security=HttpSecurity(allowed_hosts=("testserver",))))


def assert_public(value: object) -> None:
    if isinstance(value, dict):
        assert not set(value) & set(FIXTURES["forbiddenPublicKeys"])
        for child in value.values():
            assert_public(child)
    elif isinstance(value, list):
        for child in value:
            assert_public(child)


@pytest.mark.parametrize("case", FIXTURES["cases"], ids=[case["id"] for case in FIXTURES["cases"]])
def test_semantic_v1(case: dict[str, Any]) -> None:
    headers = dict(case.get("headers", {}))
    if case["credential"] != "none":
        credential = FIXTURES["app"]["credential"] + (
            "-wrong" if case["credential"] == "invalid" else ""
        )
        headers["Authorization"] = "Bearer " + credential
    response = app(case).request(
        case["method"],
        case["path"],
        headers=headers,
        **({"json": case["json"]} if "json" in case else {}),
    )
    body = response.json()
    expected = case["expect"]
    assert response.status_code == expected["status"], response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"]
    assert_public(body)
    if "data" in expected:
        assert body["data"] == expected["data"]
    if expected.get("meta") is False:
        assert "meta" not in body
    if "pagination" in expected:
        assert body["meta"]["pagination"] == expected["pagination"]
        assert body["meta"]["rowCount"] == len(body["data"])
        assert isinstance(body["meta"]["timingMs"], (int, float))
        assert body["meta"]["cache"] == {"hit": False}
    if "errorType" in expected:
        assert body["error"]["type"] == expected["errorType"]
    if "discovery" in expected:
        assert body == expected["discovery"]
