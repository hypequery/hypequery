"""Language-neutral semantic HTTP fixtures against Python's ASGI app and its core."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from core_transport import CoreClient
from hypequery.datasets import (
    CompiledQuery,
    Dataset,
    DatasetLimits,
    create_dataset_client,
    create_dataset_registry,
    dimension,
    measure,
)
from hypequery.datasets.aggregations import (
    count,
)
from hypequery.datasets.client import ResultScalar
from hypequery.serve import (
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    ProductionProfile,
    add_dataset_endpoint,
    add_discovery_endpoint,
    add_metric_endpoint,
    bearer_token,
    create_app,
    create_router,
    default_tenant_resolver,
)
from hypequery.serve.core import Api
from hypequery.serve.core.authentication import Authentication
from hypequery.serve.core.discovery import add_discovery_route
from hypequery.serve.core.endpoints import DatasetEndpointCore, add_dataset_route

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


def app(case: dict[str, Any], transport: str = "embedded") -> TestClient | CoreClient:
    """The fixture app, served by FastAPI (with or without production) or the core."""

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

    client = create_dataset_client(executor=Executor())
    policy = EndpointPolicy(
        tenant="required" if case.get("tenantRequired") else "optional",
        required_roles=frozenset(case.get("requiredRoles", [])),
        required_scopes=frozenset(case.get("requiredScopes", [])),
    )
    dataset_path = f"/datasets/{config['dataset']}/query"
    metric_path = f"/metrics/{config['measure']}"
    if transport == "core":
        api = Api(
            authentication=Authentication(authenticate, bearer_token(), default_tenant_resolver)
        )
        add_dataset_route(
            api, dataset_path, DatasetEndpointCore(dataset=dataset, client=client, policy=policy)
        )
        add_dataset_route(
            api,
            metric_path,
            DatasetEndpointCore(
                dataset=dataset, measure=config["measure"], client=client, policy=policy
            ),
        )
        add_discovery_route(
            api, "/discovery", registry=create_dataset_registry(dataset), policy=policy
        )
        return CoreClient(api)
    router = create_router(authenticate=authenticate)
    add_dataset_endpoint(router, dataset_path, dataset=dataset, client=client, policy=policy)
    add_metric_endpoint(
        router,
        metric_path,
        dataset=dataset,
        measure=config["measure"],
        client=client,
        policy=policy,
    )
    add_discovery_endpoint(router, registry=create_dataset_registry(dataset), policy=policy)
    return TestClient(
        create_app(
            router,
            security=HttpSecurity(allowed_hosts=("testserver",)),
            production=ProductionProfile() if transport == "production" else None,
        )
    )


def assert_public(value: object) -> None:
    if isinstance(value, dict):
        assert not set(value) & set(FIXTURES["forbiddenPublicKeys"])
        for child in value.values():
            assert_public(child)
    elif isinstance(value, list):
        for child in value:
            assert_public(child)


@pytest.mark.parametrize("case", FIXTURES["cases"], ids=[case["id"] for case in FIXTURES["cases"]])
# "core" runs the cases against `Api.handle` with no framework at all. Production
# budgets are still FastAPI middleware (decision 0023 step 2), so the core runs
# without a production profile.
@pytest.mark.parametrize("transport", ["embedded", "production", "core"])
def test_semantic_v1(case: dict[str, Any], transport: str) -> None:
    headers = dict(case.get("headers", {}))
    if case["credential"] != "none":
        credential = FIXTURES["app"]["credential"] + (
            "-wrong" if case["credential"] == "invalid" else ""
        )
        headers["Authorization"] = "Bearer " + credential
    response = app(case, transport).request(
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
        # The fixture apps have no result cache, so none is reported.
        assert "cache" not in body["meta"]
    if "errorType" in expected:
        assert body["error"]["type"] == expected["errorType"]
    if "discovery" in expected:
        assert body == expected["discovery"]
