"""A served `Api` for MCP tests: two endpoints, a fake executor, bearer tokens."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from hypequery.datasets import (
    ClientQueryProfile,
    CompiledQuery,
    Dataset,
    create_dataset_client,
    dimension,
    measure,
)
from hypequery.datasets.client import ResultScalar
from hypequery.serve import (
    Api,
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    add_metric_endpoint,
    create_api,
)

SECURITY = HttpSecurity(allowed_hosts=("analytics.example.com",))


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


@dataclass
class Executor:
    """Three rows of whatever the statement selects; records every query."""

    seen: list[CompiledQuery] = field(default_factory=list)
    values: dict[str, ResultScalar] = field(default_factory=lambda: {"country": "US", "total": 10})

    def execute(self, compiled: CompiledQuery) -> Rows:
        self.seen.append(compiled)
        match = re.search(r"LIMIT (\d+)(?: OFFSET (\d+))?$", compiled.sql)
        assert match
        limit, offset = int(match[1]), int(match[2] or 0)
        columns = tuple(re.findall(r" AS `([^`]+)`", compiled.sql.split(" FROM ", 1)[0]))
        rows = tuple(tuple(self.values.get(name, 1) for name in columns) for _ in range(3))
        return Rows(columns, rows[offset : offset + limit])


def authenticate(credential: Credential) -> Principal | None:
    if credential.value == "reader":
        return Principal(subject="alice", tenant_id="acme", scopes=frozenset({"read"}))
    return None


def orders() -> Dataset:
    return Dataset(
        name="orders",
        source="private_orders",
        tenant_key="tenant_id",
        description="Customer orders.",
        dimensions={
            "country": dimension.string(column="private_country"),
            "status": dimension.string(),
            "amount": dimension.number(groupable=False),
        },
        measures={"total": measure.count("status"), "revenue": measure.sum("amount")},
    )


def build_api(
    *, mount: str = "", discovery: bool = True, executor: Executor | None = None
) -> tuple[Api, Executor]:
    executor = executor or Executor()
    api = create_api(auth=authenticate, security=SECURITY, client_mount_path=mount)
    client = create_dataset_client(executor=executor)
    policy = EndpointPolicy(tenant="required", required_scopes=frozenset({"read"}))
    add_dataset_endpoint(
        api,
        "/orders",
        dataset=orders(),
        client=client,
        policy=policy,
        client_profile=ClientQueryProfile(),
    )
    add_metric_endpoint(
        api,
        "/orders-total",
        dataset=orders(),
        client=client,
        measure="total",
        name="ordersTotal",
        policy=policy,
        client_profile=ClientQueryProfile(),
    )
    if discovery:
        add_client_contract_endpoint(api)
    return api, executor


READER = {"Authorization": "Bearer reader"}
