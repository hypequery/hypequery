"""Dataset and measure-backed metric endpoints over the shared client."""

from __future__ import annotations

import asyncio
import copy
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from typing import cast

from pydantic import BaseModel, TypeAdapter

from ...datasets import ClientQueryProfile, Dataset
from ...datasets.client import AsyncDatasetClient, DatasetClient, DatasetQueryResult
from ...datasets.planner import CompiledQueryError, DatasetQuery, Deadline, ExecutionContext
from ...datasets.planner.resolution import selected_measure_names
from ...datasets.validation import validate_identifier
from ..events import QueryEvents
from ..models import (
    DiagnosticQueryResponse,
    MetricRequest,
    QueryDiagnostics,
    QueryRequest,
    QueryResponse,
)
from ..utils.metric_alias import MetricAlias
from ..utils.query_response import public_response
from ..utils.query_schema import endpoint_query_model
from ..utils.related_fields import (
    checked_related,
    default_measures,
    refuse_unlisted_related,
    refuse_unservable_metric,
)
from .api import Api, Call, Handler, Route
from .auth import Principal, RequestAuth
from .client_contract import ClientEndpointBinding
from .errors import serve_error
from .lifetime import RequestLifetime
from .messages import ServeRequest, ServeResponse
from .policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy
from .production import ProductionProfile
from .rate_limit import RateLimit
from .state import RequestState
from .work import run_sync

#: Serialized as FastAPI serializes a declared response model: validated
#: against the union, then dumped straight to JSON without `None` fields.
_RESPONSE: TypeAdapter[QueryResponse | DiagnosticQueryResponse] = TypeAdapter(
    QueryResponse | DiagnosticQueryResponse
)
#: A strict client endpoint takes any JSON object; its contract validates it.
_CLIENT_INPUT: TypeAdapter[object] = TypeAdapter(dict[str, object])


@dataclass(frozen=True, slots=True)
class DiagnosticAccess:
    """Host authorization and audit, both required for redacted SQL access."""

    authorize: Callable[[Principal], bool]
    audit: Callable[[Principal, str], None]

    def __post_init__(self) -> None:
        if not callable(self.authorize) or not callable(self.audit):
            raise TypeError("diagnostic access requires authorization and audit callbacks")


class DatasetEndpointCore:
    """A served dataset or metric query, independent of how it is mounted."""

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
        client_profile: ClientQueryProfile | None = None,
        include_related: Iterable[str] = (),
    ) -> None:
        if dataset.tenant_key is not None and (policy.public or policy.tenant == "forbidden"):
            raise ValueError("tenant-keyed datasets cannot be public or forbid tenants")
        if dataset.limits and dataset.limits.max_result_size == 0:
            raise ValueError("served datasets must allow at least one result")
        if measure is not None and measure not in dataset.measures:
            raise ValueError("metric measure must exist on the dataset")
        if client_profile is not None and type(client_profile) is not ClientQueryProfile:
            raise TypeError("client_profile must be a ClientQueryProfile")
        if client_profile is not None and diagnostics is not None:
            raise ValueError("strict client endpoints cannot include SQL diagnostics")
        self.client_profile = client_profile
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
        # Related fields are opt-in per endpoint: this endpoint's policy says
        # nothing about who may read the datasets a relationship reaches.
        self.include_related = checked_related(dataset, include_related)
        if measure is not None:
            refuse_unservable_metric(dataset, measure, self.include_related)
        self._default_measures = default_measures(dataset, self.include_related)

    async def query(
        self,
        request: ServeRequest,
        state: RequestState,
        auth: RequestAuth | None,
        payload: QueryRequest,
    ) -> QueryResponse:
        """Authorize, plan and run *payload*, returning the public response."""

        self.policy.authorize(auth)
        profile = state.production
        query = payload.semantic(
            self._effective_limit(payload, profile), (self.measure,) if self.measure else None
        )
        if self.alias is not None:
            query = self.alias.query(query)
        if query.measures is None and self._default_measures is not None:
            query = query.model_copy(update={"measures": self._default_measures})
        refuse_unlisted_related(self.dataset, query, self.include_related)
        result = await self._run(request, state, query, auth, profile)
        include_meta = payload.include_meta or request.headers.get("x-include-meta") == "true"
        response = public_response(
            result,
            state.request_id,
            include_meta,
            selected_measure_names(self.dataset, query),
        )
        if self.alias is not None:
            response.data = self.alias.rows(response.data)
        if include_meta and self.diagnostics and auth:
            return await self._with_diagnostics(state, response, query, auth, self.diagnostics)
        return response

    async def respond(self, call: Call, payload: QueryRequest) -> ServeResponse:
        response = await self.query(call.request, call.state, call.auth, payload)
        validated = _RESPONSE.validate_python(response, from_attributes=True)
        return ServeResponse.encoded(_RESPONSE.dump_json(validated, exclude_none=True))

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
        request: ServeRequest,
        state: RequestState,
        query: DatasetQuery,
        auth: RequestAuth | None,
        profile: ProductionProfile | None,
    ) -> DatasetQueryResult:
        """Execute under the request's lifetime, emitting one query event either way."""

        started = time.perf_counter()
        async with RequestLifetime(request, state.work) as lifetime:
            context = ExecutionContext(
                tenant=auth.tenant if auth else None,
                correlation_id=state.request_id,
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
                        state.work,
                        self.client.execute,
                        self.dataset,
                        query,
                        context=context,
                        paginate=True,
                    )
                if lifetime.cancellation.is_set():
                    raise CompiledQueryError("aborted", "The request was cancelled.")
            except (Exception, asyncio.CancelledError) as exc:
                state.work.cancel()
                if self.events:
                    await self._emit_failure(state, self.events, exc, started)
                raise
        if self.events:
            await run_sync(
                state.work,
                self.events.emit,
                self.name,
                (time.perf_counter() - started) * 1000,
                row_count=result.meta.row_count,
            )
        return result

    async def _emit_failure(
        self, state: RequestState, events: QueryEvents, exc: BaseException, started: float
    ) -> None:
        """Emit the failure event as tracked cleanup, so cancellation cannot drop it.

        A cancelled request does not wait for the event: its waiter is already
        being torn down, and the cleanup stays tracked by the request's work.
        """

        cancelled = isinstance(exc, asyncio.CancelledError)
        error = CompiledQueryError("aborted", "The request was cancelled.") if cancelled else exc
        event = state.work.start_cleanup(
            events.emit,
            self.name,
            (time.perf_counter() - started) * 1000,
            error=error,
        )
        if event is not None and not cancelled:
            await asyncio.shield(event)

    async def _with_diagnostics(
        self,
        state: RequestState,
        response: QueryResponse,
        query: DatasetQuery,
        auth: RequestAuth,
        diagnostics: DiagnosticAccess,
    ) -> QueryResponse:
        """Add redacted SQL when the host authorizes this principal; audit first."""

        allowed = await run_sync(state.work, diagnostics.authorize, auth.principal)
        if allowed is not True:
            return response
        # Audit completes before any privileged projection is returned.
        await run_sync(state.work, diagnostics.audit, auth.principal, state.request_id)
        sql = await run_sync(
            state.work,
            self.client.to_sql,
            self.dataset,
            query,
            context=ExecutionContext(tenant=auth.tenant),
        )
        return DiagnosticQueryResponse(
            **response.model_dump(), diagnostics=QueryDiagnostics(sql=sql)
        )


def add_dataset_route(
    api: Api,
    path: str,
    endpoint: DatasetEndpointCore,
    *,
    input_model: type[BaseModel] | None = None,
    limits: Sequence[RateLimit] = (),
) -> Route:
    """Serve *endpoint* at `POST path` on *api*.

    A strict client endpoint snapshots the endpoint as installed and refuses a
    path already served by POST. Other endpoints validate their body against
    *input_model*, by default the endpoint's own query model. An endpoint
    without query events of its own reports to the API's.
    """

    if endpoint.events is None and api.events is not None:
        endpoint = copy.copy(endpoint)
        endpoint.events = api.events
    tags = ("metrics" if endpoint.measure else "datasets",)
    if endpoint.client_profile is None:
        return api.add_route(
            "POST",
            path,
            _query_handler(endpoint),
            public=endpoint.policy.public,
            input=cast(
                TypeAdapter[object],
                TypeAdapter(
                    input_model
                    or endpoint_query_model(endpoint.dataset, metric=endpoint.measure is not None)
                ),
            ),
            limits=limits,
            output=cast(TypeAdapter[object], _RESPONSE),
            tags=tags,
        )
    target = copy.copy(endpoint)
    served_at = api.base_path + path
    binding = ClientEndpointBinding(
        dataset=target.dataset,
        client=target.client,
        policy=target.policy,
        profile=endpoint.client_profile,
        path=served_at,
        measure=target.measure,
        name=target.name,
        related=target.include_related,
    )
    api.client_endpoints.check(binding)
    if any(route.path == served_at and route.method == "POST" for route in api.routes):
        raise ValueError("client endpoint path is already registered")
    model = MetricRequest if target.measure is not None else QueryRequest

    async def client_query(call: Call) -> ServeResponse:
        target.policy.authorize(call.auth)
        body = installed.validate(call, call.input)
        return await target.respond(call, model.model_validate(body))

    route = api.add_route(
        "POST",
        path,
        client_query,
        public=target.policy.public,
        input=_CLIENT_INPUT,
        limits=limits,
        output=cast(TypeAdapter[object], _RESPONSE),
        tags=tags,
    )
    installed = replace(binding, route=route)
    api.client_endpoints.register(installed)
    return route


def _query_handler(endpoint: DatasetEndpointCore) -> Handler:
    if endpoint.measure is None:

        async def dataset_query(call: Call) -> ServeResponse:
            return await endpoint.respond(call, cast(QueryRequest, call.input))

        return dataset_query

    async def metric_query(call: Call) -> ServeResponse:
        payload = cast(MetricRequest, call.input)
        if "measures" in payload.model_fields_set:
            raise serve_error(400, "VALIDATION_ERROR", "A metric fixes its measure.")
        return await endpoint.respond(call, payload)

    return metric_query
