"""The tutorial exports its client contract from the installed endpoints."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from examples.client_dashboard import api

from asgi_client import AsgiClient
from hypequery.protocol import validate_protocol_client_query
from hypequery.serve import export_client_contract


def test_contract_factory_is_offline_and_framework_free() -> None:
    code = (
        "import sys; from examples.client_dashboard.api import contract; "
        "from hypequery.serve import export_client_contract; export_client_contract(contract()); "
        "forbidden = {'fastapi', 'clickhouse_connect', 'uvicorn'}; "
        "assert not forbidden & sys.modules.keys()"
    )
    subprocess.run(
        [sys.executable, "-c", code],
        check=True,
        capture_output=True,
        cwd=Path(__file__).parents[1],
    )
    contract = export_client_contract(api.contract())["contract"]
    assert [(item["id"], item["path"]) for item in contract["endpoints"]] == [
        ("orders", "/v1/orders"),
        ("sales", "/v1/sales"),
    ]
    assert "client_orders" not in json.dumps(contract)
    assert "org_id" not in json.dumps(contract)
    plan = validate_protocol_client_query(contract, "sales", {}, transport="http")
    assert plan["selectedMeasures"] == ["sales"]


def test_tutorial_served_contract_matches_the_export(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from examples.utils import server

    class Executor:
        def close(self) -> None:
            pass

    monkeypatch.setenv("HYPEQUERY_TENANT_A_TOKEN", "token-a")
    monkeypatch.setenv("HYPEQUERY_TENANT_B_TOKEN", "token-b")
    monkeypatch.setattr(server, "create_clickhouse_executor", lambda _: Executor())
    app = api.create_application()
    installed = export_client_contract(app)["contract"]
    assert installed == export_client_contract(api.contract())["contract"]
    with AsgiClient(app, base_url="http://localhost") as http:
        assert http.get("/v1/client-contract").status_code == 401
        response = http.get("/v1/client-contract", headers={"Authorization": "Bearer token-a"})
        assert response.status_code == 200
        assert response.json()["view"] == "authorized"
        preflight = http.options(
            "/v1/orders",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": (
                    "authorization,x-hypequery-client-schema,x-include-meta"
                ),
            },
        )
        assert preflight.status_code == 200
