"""Dataset and measure-backed metric endpoints over the shared client."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import Request

from ..datasets import Dataset
from ..datasets.client import AsyncDatasetClient, DatasetClient, DatasetQueryResult
from ..datasets.planner import CompiledQueryError, DatasetQuery, Deadline, ExecutionContext
from ..datasets.validation import validate_identifier
from .auth import Principal, RequestAuth
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
from .production import ProductionProfile
from .request_ids import ensure_request_id
from .router import ServeRouter, authenticated_context
from .utils.metric_alias import MetricAlias
from .utils.production_context import production_profile
from .utils.query_response import public_response
from .utils.query_schema import endpoint_query_model
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
        self.alias = MetricAlias(measure, self.name) if measure is not None else None

    async def execute(self, request: Request, payload: QueryRequest) -> QueryResponse:
        auth = authenticated_context(request)
        self.policy.authorize(auth)
        profile = production_profile(request)
        query = payload.semantic(
            self._effective_limit(payload, profile), (self.measure,) if self.measure else None
        )
        if self.alias is not None:
            query = self.alias.query(query)
        result = await self._run(request, query, auth, profile)
        include_meta = payload.include_meta or request.headers.get("x-include-meta") == "true"
        response = public_response(result, ensure_request_id(request), include_meta, self.dataset)
        if self.alias is not None:
            response.data = self.alias.rows(response.data)
        if include_meta and self.diagnostics and auth:
            return await self._with_diagnostics(request, response, query, auth, self.diagnostics)
        return response

    def _effective_limit(self, payload: QueryRequest, profile: ProductionProfile | None) -> int:
        """The caller's limit, held under the policy, process and dataset ceilings.

        The process ceiling leaves one row for the pagination probe.
        """

        cap = self.policy.max_limit
        if profile is not None:
            cap = min(cap, profile.max_result_rows - 1)
        if self.dataset.limits and self.dataset.limits.max_result_size is not None:
            cap = min(cap, self.dataset.limits.max_result_size)
        return min(payload.limit if payload.limit is not None else cap, cap)

    async def _run(
        self,
        request: Request,
        query: DatasetQuery,
        auth: RequestAuth | None,
        profile: ProductionProfile | None,
    ) -> DatasetQueryResult:
        """Execute under the request's lifetime, emitting one query event either way."""

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
                    await self._emit_failure(request, self.events, exc, started)
                raise
        if self.events:
            await run_sync(
                request,
                self.events.emit,
                self.name,
                (time.perf_counter() - started) * 1000,
                row_count=result.meta.row_count,
            )
        return result

    async def _emit_failure(
        self, request: Request, events: QueryEvents, exc: BaseException, started: float
    ) -> None:
        """Emit the failure event as tracked cleanup, so cancellation cannot drop it.

        A cancelled request does not wait for the event: its waiter is already
        being torn down, and the cleanup stays tracked by the request's work.
        """

        cancelled = isinstance(exc, asyncio.CancelledError)
        error = CompiledQueryError("aborted", "The request was cancelled.") if cancelled else exc
        event = request_work(request).start_cleanup(
            events.emit,
            self.name,
            (time.perf_counter() - started) * 1000,
            error=error,
        )
        if event is not None and not cancelled:
            await asyncio.shield(event)

    async def _with_diagnostics(
        self,
        request: Request,
        response: QueryResponse,
        query: DatasetQuery,
        auth: RequestAuth,
        diagnostics: DiagnosticAccess,
    ) -> QueryResponse:
        """Add redacted SQL when the host authorizes this principal; audit first."""

        allowed = await run_sync(request, diagnostics.authorize, auth.principal)
        if allowed is not True:
            return response
        # Audit completes before any privileged projection is returned.
        await run_sync(request, diagnostics.audit, auth.principal, ensure_request_id(request))
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
        endpoint.__annotations__["payload"] = endpoint_query_model(
            self.dataset, metric=self.measure is not None
        )
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

    create_dataset_endpoint(
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

    create_metric_endpoint(
        dataset=dataset,
        client=client,
        policy=policy,
        measure=measure,
        name=name,
        diagnostics=diagnostics,
        events=events,
    ).install(router, path)


def create_dataset_endpoint(
    *,
    dataset: Dataset,
    client: DatasetClient | AsyncDatasetClient,
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
    diagnostics: DiagnosticAccess | None = None,
    events: QueryEvents | None = None,
) -> DatasetEndpoint:
    """Create a dataset endpoint without registering a route.

    Call ``endpoint.install(api, path)`` to register it, or use
    ``add_dataset_endpoint`` to create and register in one step.
    """
    return DatasetEndpoint(
        dataset=dataset, client=client, policy=policy, diagnostics=diagnostics, events=events
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
    )
