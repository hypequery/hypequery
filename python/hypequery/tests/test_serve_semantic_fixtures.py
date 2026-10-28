"""Language-neutral semantic HTTP fixtures against Python's core and every adapter.

The adapters are those in `serve_transports.py`: ASGI, WSGI, Django under WSGI
and ASGI, and Flask. Each must also answer as the core does.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

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
    create_api,
)
from serve_transports import TRANSPORTS as SERVED_BY
from serve_transports import answer, serve_client

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


TRANSPORTS = [f"{name}{profile}" for name in SERVED_BY for profile in ("", "-production")]


def app(case: dict[str, Any], transport: str = "core") -> Any:
    """The fixture app, served by the core or an adapter, with or without production."""

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
    api = create_api(
        auth=authenticate,
        security=HttpSecurity(allowed_hosts=("testserver",)),
        production=ProductionProfile() if transport.endswith("-production") else None,
    )
    add_dataset_endpoint(
        api, f"/datasets/{config['dataset']}/query", dataset=dataset, client=client, policy=policy
    )
    add_metric_endpoint(
        api,
        f"/metrics/{config['measure']}",
        dataset=dataset,
        measure=config["measure"],
        client=client,
        policy=policy,
    )
    add_discovery_endpoint(api, registry=create_dataset_registry(dataset), policy=policy)
    return serve_client(transport.removesuffix("-production"), api)


def assert_public(value: object) -> None:
    if isinstance(value, dict):
        assert not set(value) & set(FIXTURES["forbiddenPublicKeys"])
        for child in value.values():
            assert_public(child)
    elif isinstance(value, list):
        for child in value:
            assert_public(child)


def send(case: dict[str, Any], transport: str) -> Any:
    headers = dict(case.get("headers", {}))
    if case["credential"] != "none":
        credential = FIXTURES["app"]["credential"] + (
            "-wrong" if case["credential"] == "invalid" else ""
        )
        headers["Authorization"] = "Bearer " + credential
    return app(case, transport).request(
        case["method"],
        case["path"],
        headers=headers,
        **({"json": case["json"]} if "json" in case else {}),
    )


@pytest.mark.parametrize("case", FIXTURES["cases"], ids=[case["id"] for case in FIXTURES["cases"]])
# "core" runs the cases against `Api.handle` with no server at all; the others
# serve them through an adapter.
@pytest.mark.parametrize("transport", TRANSPORTS)
def test_semantic_v1(case: dict[str, Any], transport: str) -> None:
    response = send(case, transport)
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


def _timeless(response: Any) -> tuple[int, dict[str, str], object]:
    """`answer`, the body parsed, without its measured query time or request id."""

    status, headers, content = answer(response)
    body = json.loads(content)
    if isinstance(body.get("meta"), dict):
        body["meta"].pop("timingMs", None)
        body["meta"].pop("requestId", None)
    return status, headers, body


@pytest.mark.parametrize("case", FIXTURES["cases"], ids=[case["id"] for case in FIXTURES["cases"]])
@pytest.mark.parametrize("transport", [name for name in TRANSPORTS if not name.startswith("core")])
def test_every_adapter_answers_as_the_core_does(case: dict[str, Any], transport: str) -> None:
    core = "core-production" if transport.endswith("-production") else "core"
    assert _timeless(send(case, transport)) == _timeless(send(case, core))
