"""Run: python -m examples.governed_agent (from python/hypequery).

Seed examples/seed.sql, set CLICKHOUSE_* and HYPEQUERY_AGENT_TOKEN. A trusted
agent gateway holds the token, GETs /discovery and POSTs /agent/revenue with
{"dimensions":["country"]}. Expose those HTTP calls as tools in your agent host.
The agent receives aggregate results and logical schema, with no SQL execution tool.
"""

from fastapi import FastAPI

from hypequery.datasets import DatasetClient, create_dataset_registry, dataset, dimension, measure
from hypequery.serve import (
    EndpointPolicy,
    Principal,
    ServeRouter,
    add_discovery_endpoint,
    create_metric_endpoint,
    start_server,
)

from .utils.config import required_environment
from .utils.server import application

analytics = dataset(
    "analytics",
    source="example_orders",
    tenant_key="org_id",
    dimensions={"country": dimension.string()},
    measures={"revenue": measure.sum("amount")},
)
policy = EndpointPolicy(
    tenant="required",
    required_scopes=frozenset({"agent:analytics"}),
    max_limit=20,
)


def install(api: ServeRouter, client: DatasetClient) -> None:
    create_metric_endpoint(
        dataset=analytics, measure="revenue", client=client, policy=policy
    ).install(api, "/agent/revenue")
    add_discovery_endpoint(api, registry=create_dataset_registry(analytics), policy=policy)


def create_application() -> FastAPI:
    return application(
        datasets=(analytics,),
        install=install,
        principals={
            required_environment("HYPEQUERY_AGENT_TOKEN"): Principal(
                subject="agent-gateway",
                tenant_id="a",
                scopes=frozenset({"agent:analytics"}),
            )
        },
    )


if __name__ == "__main__":
    start_server(create_application())
