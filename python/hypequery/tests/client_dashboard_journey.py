"""Live ClickHouse tutorial checks shared with the isolated examples journey."""

from decimal import Decimal
from pathlib import Path
from typing import Protocol

from examples.client_dashboard import api, definitions

from asgi_client import AsgiClient


class TutorialDatabase(Protocol):
    def command(self, query: str) -> object: ...


def exercise_live_tutorial(admin: TutorialDatabase) -> None:
    """Called by the existing live-example test with its isolated database."""
    seed = Path(definitions.__file__).with_name("seed.sql").read_text()
    for _ in range(2):
        for statement in seed.split(";"):
            if statement.strip():
                admin.command(statement)
    with AsgiClient(api.create_application(), base_url="http://localhost") as http:
        for token, expected in (("tenant-a-test", Decimal(60)), ("tenant-b-test", Decimal(1000))):
            headers = {"Authorization": "Bearer " + token}
            contract = http.get("/v1/client-contract", headers=headers).json()
            hashes = {item["id"]: item["schemaHash"] for item in contract["endpoints"]}
            response = http.post(
                "/v1/sales",
                json={},
                headers={**headers, "X-Hypequery-Client-Schema": hashes["sales"]},
            )
            assert response.status_code == 200, response.text
            value = response.json()["data"][0]["sales"]
            assert isinstance(value, str)
            assert Decimal(value) == expected
        headers = {"Authorization": "Bearer tenant-a-test"}
        pages = []
        for offset in range(3):
            result = http.post(
                "/v1/orders",
                headers=headers,
                json={
                    "dimensions": ["country"],
                    "measures": ["revenue"],
                    "limit": 1,
                    "offset": offset,
                    "includeMeta": True,
                    "orderBy": [{"field": "country", "direction": "asc"}],
                },
            )
            assert result.status_code == 200, result.text
            body = result.json()
            pages.extend(body["data"])
            assert body["meta"]["pagination"]["hasMore"] == (offset < 2)
        assert {row["country"] for row in pages} == {"US", "DE", None}
        assert sum(Decimal(row["revenue"]) for row in pages) == Decimal(60)
        for payload in ({"sql": "SELECT 1"}, {"tenant": "b"}):
            assert http.post("/v1/orders", headers=headers, json=payload).status_code == 400
        stale = http.post(
            "/v1/orders", headers={**headers, "X-Hypequery-Client-Schema": "0" * 64}, json={}
        )
        assert stale.status_code == 409
