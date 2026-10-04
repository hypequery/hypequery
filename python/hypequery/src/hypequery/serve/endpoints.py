"""Dataset and measure-backed metric endpoints over the shared client."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import Request

from ..datasets import Dataset
from ..datasets.client import AsyncDatasetClient, DatasetClient
from ..datasets.planner import CompiledQueryError, Deadline, ExecutionContext
from ..datasets.query_helpers import Order
from ..datasets.validation import validate_identifier
from .auth import Principal
from .errors import ServeError
from .events import QueryEvents
from .lifetime import RequestLifetime
from .models import (
    DiagnosticQueryResponse,
    MetricRequest,
    QueryDiagnostics,
    QueryRequest,
    QueryResponse,
)
from .policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy
from .request_ids import ensure_request_id
from .router import ServeRouter, authenticated_context
from .utils.production_context import production_profile
from .utils.query_response import public_response
from .utils.request_work import request_work, run_sync


@dataclass(frozen=True, slots=True)
class DiagnosticAccess:
    """Host authorization and audit, both required for redacted SQL access."""

    authorize: Callable[[Principal], bool]
    audit: Callable[[Principal, str], None]

    def __post_init__(self) -> None:
        if not callable(self.authorize) or not callable(self.audit):
            raise TypeError("diagnostic access requires authorization and audit callbacks")


class DatasetEndpoint:
    def __init__(
        self,
        *,
        dataset: Dataset,
        client: DatasetClient | AsyncDatasetClient,
        policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
        measure: str | None = None,
        name: str | None = None,
        diagnostics: DiagnosticAccess | None = None,
        events: QueryEvents | None = None,
    ) -> None:
        if dataset.tenant_key is not None and (policy.public or policy.tenant == "forbidden"):
            raise ValueError("tenant-keyed datasets cannot be public or forbid tenants")
        if dataset.limits and dataset.limits.max_result_size == 0:
            raise ValueError("served datasets must allow at least one result")
        if measure is not None and measure not in dataset.measures:
            raise ValueError("metric measure must exist on the dataset")
        self.dataset = dataset
        self.client = client
        self.policy = policy
        self.measure = measure
        self.name = validate_identifier(name if name is not None else measure or dataset.name)
        if measure is not None and self.name != measure and self.name in dataset.dimensions:
            raise ValueError("metric name must not shadow a dataset dimension")
        self.diagnostics = diagnostics
        self.events = events

    async def execute(self, request: Request, payload: QueryRequest) -> QueryResponse:
        auth = authenticated_context(request)
        self.policy.authorize(auth)
        cap = self.policy.max_limit
        profile = production_profile(request)
        if profile is not None:
            cap = min(cap, profile.max_result_rows - 1)
        if self.dataset.limits and self.dataset.limits.max_result_size is not None:
            cap = min(cap, self.dataset.limits.max_result_size)
        limit = min(payload.limit if payload.limit is not None else cap, cap)
        query = payload.semantic(limit, (self.measure,) if self.measure else None)
        if self.measure is not None:
            query = query.model_copy(
                update={
                    "order_by": tuple(
                        Order(
                            field=self.measure if order.field == self.name else order.field,
                            direction=order.direction,
                        )
                        for order in query.order_by
                    )
                }
            )
        started = time.perf_counter()
        async with RequestLifetime(request) as lifetime:
            context = ExecutionContext(
                tenant=auth.tenant if auth else None,
                correlation_id=ensure_request_id(request),
                cancellation=lifetime.cancellation,
                deadline=Deadline.after(profile.timeout_seconds) if profile else None,
                settings=profile.query_settings() if profile else None,
            )
            try:
                if isinstance(self.client, AsyncDatasetClient):
                    result = await self.client.execute(
                        self.dataset, query, context=context, paginate=True
                    )
                else:
                    result = await run_sync(
                        request,
                        self.client.execute,
                        self.dataset,
                        query,
                        context=context,
                        paginate=True,
                    )
                if lifetime.cancellation.is_set():
                    raise CompiledQueryError("aborted", "The request was cancelled.")
            except (Exception, asyncio.CancelledError) as exc:
                request_work(request).cancel()
                if self.events:
                    error = (
                        CompiledQueryError("aborted", "The request was cancelled.")
                        if isinstance(exc, asyncio.CancelledError)
                        else exc
                    )
                    event = request_work(request).start_cleanup(
                        self.events.emit,
                        self.name,
                        (time.perf_counter() - started) * 1000,
                        error=error,
                    )
                    if event is not None and not isinstance(exc, asyncio.CancelledError):
                        await asyncio.shield(event)
                raise
        if self.events:
            await run_sync(
                request,
                self.events.emit,
                self.name,
                (time.perf_counter() - started) * 1000,
                row_count=result.meta.row_count,
            )
        include_meta = payload.include_meta or request.headers.get("x-include-meta") == "true"
        response = public_response(result, ensure_request_id(request), include_meta, self.dataset)
        if self.measure is not None and self.name != self.measure:
            response.data = [
                {self.name if key == self.measure else key: value for key, value in row.items()}
                for row in response.data
            ]
        if include_meta and self.diagnostics and auth:
            allowed = await run_sync(request, self.diagnostics.authorize, auth.principal)
            if allowed is True:
                # Audit completes before any privileged projection is returned.
                await run_sync(
                    request, self.diagnostics.audit, auth.principal, ensure_request_id(request)
                )
                sql = await run_sync(
                    request,
                    self.client.to_sql,
                    self.dataset,
                    query,
                    context=ExecutionContext(tenant=auth.tenant),
                )
                return DiagnosticQueryResponse(
                    **response.model_dump(), diagnostics=QueryDiagnostics(sql=sql)
                )
        return response

    def install(self, router: ServeRouter, path: str) -> None:
        endpoint: Callable[..., Awaitable[QueryResponse]]
        if self.measure is None:

            async def dataset_query(request: Request, payload: QueryRequest) -> QueryResponse:
                return await self.execute(request, payload)

            endpoint = dataset_query
        else:

            async def metric_query(request: Request, payload: MetricRequest) -> QueryResponse:
                if "measures" in payload.model_fields_set:
                    raise ServeError(400, "VALIDATION_ERROR", "A metric fixes its measure.")
                return await self.execute(request, payload)

            endpoint = metric_query
        if self.policy.public:
            router.public(endpoint)
        router.add_api_route(
            path,
            endpoint,
            methods=["POST"],
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
) -> None:
    """Register a bounded POST query endpoint, authenticated by default."""

    DatasetEndpoint(
        dataset=dataset, client=client, policy=policy, diagnostics=diagnostics, events=events
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
) -> None:
    """Register a metric fixed to one dataset measure (no formula metric surface yet)."""

    DatasetEndpoint(
        dataset=dataset,
        client=client,
        policy=policy,
        measure=measure,
        name=name,
        diagnostics=diagnostics,
        events=events,
    ).install(router, path)
