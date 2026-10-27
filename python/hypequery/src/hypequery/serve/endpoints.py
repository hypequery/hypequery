"""Dataset and measure-backed metric endpoints over the shared client.

The query pipeline lives in the core (`core/endpoints.py`); this module installs
it on a `ServeRouter`.
"""

from __future__ import annotations

from collections.abc import Iterable

from fastapi import Request

from ..datasets import ClientQueryProfile, Dataset
from ..datasets.client import AsyncDatasetClient, DatasetClient
from .core.endpoints import DatasetEndpointCore, DiagnosticAccess, add_dataset_route
from .events import QueryEvents
from .models import DiagnosticQueryResponse, QueryRequest, QueryResponse
from .policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy
from .router import ServeRouter, authenticated_context
from .utils.query_schema import endpoint_query_model
from .utils.starlette_bridge import request_state, serve_request

__all__ = [
    "DatasetEndpoint",
    "DiagnosticAccess",
    "add_dataset_endpoint",
    "add_metric_endpoint",
    "create_dataset_endpoint",
    "create_metric_endpoint",
]


class DatasetEndpoint(DatasetEndpointCore):
    """A dataset or metric endpoint, installed on a `ServeRouter`."""

    async def execute(self, request: Request, payload: QueryRequest) -> QueryResponse:
        """Run *payload* for *request*, as the installed route does."""

        return await self.query(
            serve_request(request), request_state(request), authenticated_context(request), payload
        )

    def install(self, router: ServeRouter, path: str) -> None:
        model = (
            None
            if self.client_profile is not None
            else endpoint_query_model(self.dataset, metric=self.measure is not None)
        )
        route = add_dataset_route(
            router._api,
            router.prefix + path,
            self,
            input_model=model,
            path_taken=router._post_path_taken,
        )
        router._add_core_route(
            path,
            route,
            documented_input=dict[str, object] if model is None else model,
            response_model=QueryResponse | DiagnosticQueryResponse,
            response_model_exclude_none=True,
            tags=["metrics" if self.measure else "datasets"],
        )


def add_dataset_endpoint(
    router: ServeRouter,
    path: str,
    *,
    dataset: Dataset,
    client: DatasetClient | AsyncDatasetClient,
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
    diagnostics: DiagnosticAccess | None = None,
    events: QueryEvents | None = None,
    client_profile: ClientQueryProfile | None = None,
    include_related: Iterable[str] = (),
) -> None:
    """Register a bounded POST query endpoint, authenticated by default."""

    create_dataset_endpoint(
        dataset=dataset,
        client=client,
        policy=policy,
        diagnostics=diagnostics,
        events=events,
        client_profile=client_profile,
        include_related=include_related,
    ).install(router, path)


def add_metric_endpoint(
    router: ServeRouter,
    path: str,
    *,
    dataset: Dataset,
    measure: str,
    name: str | None = None,
    client: DatasetClient | AsyncDatasetClient,
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
    diagnostics: DiagnosticAccess | None = None,
    events: QueryEvents | None = None,
    client_profile: ClientQueryProfile | None = None,
    include_related: Iterable[str] = (),
) -> None:
    """Register a metric fixed to one dataset measure (no formula metric surface yet)."""

    create_metric_endpoint(
        dataset=dataset,
        client=client,
        policy=policy,
        measure=measure,
        name=name,
        diagnostics=diagnostics,
        events=events,
        client_profile=client_profile,
        include_related=include_related,
    ).install(router, path)


def create_dataset_endpoint(
    *,
    dataset: Dataset,
    client: DatasetClient | AsyncDatasetClient,
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
    diagnostics: DiagnosticAccess | None = None,
    events: QueryEvents | None = None,
    client_profile: ClientQueryProfile | None = None,
    include_related: Iterable[str] = (),
) -> DatasetEndpoint:
    """Create a dataset endpoint without registering a route.

    Call ``endpoint.install(api, path)`` to register it, or use
    ``add_dataset_endpoint`` to create and register in one step. Fields of
    related datasets are exposed only for the relationships named in
    *include_related*, since *policy* does not cover those datasets.
    """
    return DatasetEndpoint(
        dataset=dataset,
        client=client,
        policy=policy,
        diagnostics=diagnostics,
        events=events,
        client_profile=client_profile,
        include_related=include_related,
    )


def create_metric_endpoint(
    *,
    dataset: Dataset,
    measure: str,
    name: str | None = None,
    client: DatasetClient | AsyncDatasetClient,
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
    diagnostics: DiagnosticAccess | None = None,
    events: QueryEvents | None = None,
    client_profile: ClientQueryProfile | None = None,
    include_related: Iterable[str] = (),
) -> DatasetEndpoint:
    """Create a one-measure metric endpoint without registering a route.

    Call ``endpoint.install(api, path)`` to register it, or use
    ``add_metric_endpoint`` to create and register in one step.
    """
    return DatasetEndpoint(
        dataset=dataset,
        client=client,
        policy=policy,
        measure=measure,
        name=name,
        diagnostics=diagnostics,
        events=events,
        client_profile=client_profile,
        include_related=include_related,
    )
