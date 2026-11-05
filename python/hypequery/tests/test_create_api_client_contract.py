"""`create_api` endpoints in the client contract: opting in, metric names, empty exports."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from asgi_client import AsgiClient
from hypequery.datasets import (
    ClientQueryProfile,
    CompiledQuery,
    Dataset,
    create_dataset_client,
    dimension,
    measure,
)
from hypequery.serve import (
    Api,
    Credential,
    Principal,
    add_dataset_endpoint,
    create_api,
    create_dataset_endpoint,
    create_metric_endpoint,
    export_client_contract,
    to_asgi_app,
)

AUTH = {"Authorization": "Bearer reader"}
PROFILE = ClientQueryProfile(default_limit=5, max_limit=50, max_offset=10)


def _authenticate(credential: Credential) -> Principal | None:
    return Principal(subject="reader") if credential.value == "reader" else None


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[int, ...], ...] = ((7,),)


@dataclass
class Executor:
    column: str = "total"
    seen: list[CompiledQuery] = field(default_factory=list)

    def execute(self, compiled: CompiledQuery) -> Rows:
        self.seen.append(compiled)
        return Rows(columns=(self.column,))


ORDERS = Dataset(
    name="orders",
    source="private_orders",
    dimensions={"country": dimension.string()},
    measures={"revenue": measure.sum("amount"), "total": measure.count("country")},
)
INVOICES = Dataset(
    name="invoices",
    source="private_invoices",
    dimensions={"country": dimension.string()},
    measures={"total": measure.count("country")},
)


def _endpoints(api: Api) -> dict[str, dict[str, object]]:
    contract = export_client_contract(api)["contract"]
    return {str(item["id"]): dict(item) for item in contract["endpoints"]}


# --- opting the Dataset shorthand in --------------------------------------


def test_client_profile_puts_every_dataset_entry_in_the_contract() -> None:
    client = create_dataset_client(executor=Executor())
    api = create_api(
        auth=_authenticate,
        client=client,
        datasets={"orders": ORDERS, "invoices": INVOICES},
        client_profile=PROFILE,
    )
    endpoints = _endpoints(api)
    assert {key: item["path"] for key, item in endpoints.items()} == {
        "orders": "/datasets/orders/query",
        "invoices": "/datasets/invoices/query",
    }
    assert endpoints["orders"]["limits"]["maxLimit"] == 50  # type: ignore[index]


def test_shorthand_endpoints_are_strict_and_schema_pinned() -> None:
    executor = Executor()
    api = create_api(
        auth=_authenticate,
        client=create_dataset_client(executor=executor),
        datasets={"orders": ORDERS},
        client_profile=PROFILE,
    )
    pin = _endpoints(api)["orders"]["schemaHash"]
    with AsgiClient(to_asgi_app(api)) as http:
        served = http.post(
            "/datasets/orders/query",
            json={"measures": ["total"]},
            headers={**AUTH, "X-Hypequery-Client-Schema": str(pin)},
        )
        assert served.status_code == 200, served.text
        stale = http.post(
            "/datasets/orders/query",
            json={"measures": ["total"]},
            headers={**AUTH, "X-Hypequery-Client-Schema": "0" * 64},
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["details"] == {"code": "CLIENT_SCHEMA_CHANGED"}
        # The profile is enforced, not just advertised: an offset past it is refused.
        beyond = {"measures": ["total"], "offset": 11}
        assert http.post("/datasets/orders/query", json=beyond, headers=AUTH).status_code == 400
    assert len(executor.seen) == 1


def test_endpoint_entries_keep_their_own_profile() -> None:
    client = create_dataset_client(executor=Executor())
    api = create_api(
        auth=_authenticate,
        client=client,
        datasets={
            "orders": ORDERS,
            "invoices": create_dataset_endpoint(
                dataset=INVOICES,
                client=client,
                client_profile=ClientQueryProfile(default_limit=2, max_limit=3),
            ),
            "plain": create_dataset_endpoint(dataset=ORDERS, client=client),
        },
        client_profile=PROFILE,
    )
    endpoints = _endpoints(api)
    assert sorted(endpoints) == ["invoices", "orders"]
    assert endpoints["invoices"]["limits"]["maxLimit"] == 3  # type: ignore[index]


def test_a_client_profile_with_no_dataset_entry_to_apply_to_is_refused() -> None:
    client = create_dataset_client(executor=Executor())
    with pytest.raises(ValueError, match="applies to Dataset entries"):
        create_api(
            auth=_authenticate,
            client=client,
            datasets={"orders": create_dataset_endpoint(dataset=ORDERS, client=client)},
            client_profile=PROFILE,
        )
    with pytest.raises(ValueError, match="applies to Dataset entries"):
        create_api(auth=_authenticate, client_profile=PROFILE)
    with pytest.raises(TypeError, match="ClientQueryProfile"):
        create_api(
            auth=_authenticate,
            client=client,
            datasets={"orders": ORDERS},
            client_profile={"max_limit": 5},  # type: ignore[arg-type]
        )


# --- metric names ---------------------------------------------------------


def test_a_metric_key_is_its_contract_id_and_output_alias() -> None:
    executor = Executor(column="revenue")
    client = create_dataset_client(executor=executor)
    api = create_api(
        auth=_authenticate,
        client=client,
        metrics={
            "rev": create_metric_endpoint(
                dataset=ORDERS, measure="revenue", client=client, client_profile=PROFILE
            )
        },
    )
    (endpoint,) = _endpoints(api).values()
    assert (endpoint["id"], endpoint["path"]) == ("rev", "/metrics/rev")
    assert list(endpoint["measures"]) == ["rev"]  # type: ignore[call-overload]
    with AsgiClient(to_asgi_app(api)) as http:
        response = http.post("/metrics/rev", json={}, headers=AUTH)
    assert response.status_code == 200, response.text
    assert list(response.json()["data"][0]) == ["rev"]


def test_a_metric_named_differently_from_its_key_is_refused() -> None:
    client = create_dataset_client(executor=Executor())
    named = create_metric_endpoint(dataset=ORDERS, measure="revenue", name="sales", client=client)
    with pytest.raises(ValueError, match="'rev' is named 'sales'"):
        create_api(auth=_authenticate, client=client, metrics={"rev": named})
    api = create_api(auth=_authenticate, client=client, metrics={"sales": named})
    assert [route.path for route in api.routes if route.method == "POST"] == ["/metrics/sales"]


def test_a_metric_key_cannot_shadow_a_dimension() -> None:
    client = create_dataset_client(executor=Executor())
    with pytest.raises(ValueError, match="shadow a dataset dimension"):
        create_api(
            auth=_authenticate,
            client=client,
            metrics={
                "country": create_metric_endpoint(dataset=ORDERS, measure="total", client=client)
            },
        )


# --- empty exports --------------------------------------------------------


def test_an_empty_build_export_names_the_endpoints_without_a_profile() -> None:
    client = create_dataset_client(executor=Executor())
    api = create_api(
        auth=_authenticate,
        client=client,
        client_mount_path="/api",
        datasets={"orders": ORDERS},
        metrics={"rev": create_metric_endpoint(dataset=ORDERS, measure="revenue", client=client)},
    )
    with pytest.raises(ValueError, match="no endpoints") as raised:
        export_client_contract(api)
    assert str(raised.value).startswith(
        "The client contract has no endpoints: POST /api/datasets/orders/query, "
        "POST /api/metrics/rev have no client_profile. Pass client_profile= to create_api"
    )
    # The live authorized view may legitimately show a caller nothing.
    assert export_client_contract(api, view="authorized", auths={})["contract"]["endpoints"] == []


def test_an_api_with_one_opted_in_endpoint_exports_it() -> None:
    client = create_dataset_client(executor=Executor())
    api = create_api(auth=_authenticate, client=client, datasets={"orders": ORDERS})
    add_dataset_endpoint(
        api, "/v1/invoices", dataset=INVOICES, client=client, client_profile=PROFILE
    )
    assert list(_endpoints(api)) == ["invoices"]
