"""Dataset clients: plan a semantic query, execute it, key the rows.

`create_dataset_client` is the canonical entry point, as `createDatasetClient`
is in TypeScript. The planner stays the only thing that builds SQL; a client
adds target resolution, request validation, result caching, and result shaping
around it.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import NoReturn, TypedDict, Unpack

from ..cache import CachedRows, ResultCache
from ..dataset import Dataset
from ..planner import (
    DEFAULT_QUERY_SETTINGS,
    CompiledQuery,
    CompiledQueryError,
    DatasetQuery,
    ExecutionContext,
    QuerySettings,
    TenantScope,
    plan_dataset_query,
)
from ..planner.settings import tighten_query_settings
from ..registry import DatasetRegistry
from ..utils.query_timezone import validate_timezone
from .inputs import DatasetTarget, QueryInput, coerce_query, resolve_dataset
from .pagination import page_limit
from .results import (
    AsyncQueryExecutor,
    CacheStatus,
    DatasetQueryResult,
    QueryExecutor,
    ResultRows,
    ValidationResult,
    build_result,
)
from .tenant_binding import bind_tenant, require_tenant_capability

#: Failures that mean "this query would not plan", as opposed to "this call
#: should not run now". A cancelled or expired context is the second kind and
#: is raised from `validate` rather than reported as an invalid query.
_INVALID_QUERY = frozenset(("input-invalid", "not-found", "too-large", "tenant-required"))


@dataclass(frozen=True, slots=True)
class _Planned:
    dataset: Dataset
    query: DatasetQuery
    compiled: CompiledQuery


@dataclass(frozen=True, slots=True)
class _Execution:
    """One execution between planning and shaping its result."""

    planned: _Planned
    key: str | None
    status: CacheStatus
    started: float
    paginate: bool
    hit: CachedRows | None


class ExecuteOptions(TypedDict, total=False):
    """Options every `execute` accepts, forwarded unchanged by tenant-bound clients."""

    use_cache: bool
    paginate: bool


class _DatasetClientBase:
    __slots__ = ("_cache", "_registry", "_settings", "_timezone")

    def __init__(
        self,
        registry: DatasetRegistry | None,
        settings: QuerySettings,
        cache: ResultCache | None,
        timezone: str = "UTC",
    ) -> None:
        self._registry = registry
        self._settings = settings
        self._cache = cache
        self._timezone = validate_timezone(timezone)

    def _plan(
        self,
        target: DatasetTarget,
        query: QueryInput,
        context: ExecutionContext | None,
        *,
        paginate: bool = False,
    ) -> _Planned:
        dataset = resolve_dataset(target, self._registry)
        semantic = coerce_query(query)
        if semantic.timezone is None:
            semantic = semantic.model_copy(update={"timezone": self._timezone})
        if paginate:
            effective_settings = tighten_query_settings(
                self._settings, context.settings if context else None
            )
            limit = page_limit(
                semantic.limit,
                dataset.limits.max_result_size if dataset.limits else None,
                effective_settings["max_result_rows"],
            )
            semantic = semantic.model_copy(update={"limit": limit})
        compiled = plan_dataset_query(
            dataset,
            semantic,
            registry=self._registry,
            context=context,
            settings=self._settings,
            overfetch=paginate,
        )
        return _Planned(dataset, semantic, compiled)

    def _cache_key(
        self,
        planned: _Planned,
        context: ExecutionContext | None,
        use_cache: bool,
        *,
        paginate: bool = False,
    ) -> tuple[str | None, CacheStatus]:
        # Planning ran first, so a request that fails admission, tenant
        # resolution, or validation never reaches the cache.
        if self._cache is None:
            return None, "off"
        if not use_cache:
            return None, "bypass"
        cache_query = planned.query
        if paginate and cache_query.limit is not None:
            cache_query = cache_query.model_copy(update={"limit": cache_query.limit + 1})
        key = self._cache.key_for(planned.dataset, cache_query, context, self._registry)
        return key, ("miss" if key is not None else "bypass")

    def _start(
        self,
        target: DatasetTarget,
        query: QueryInput,
        context: ExecutionContext | None,
        *,
        use_cache: bool,
        paginate: bool,
    ) -> _Execution:
        """Plan, then key and look up the cache. Executing is the caller's part."""

        planned = self._plan(target, query, context, paginate=paginate)
        started = time.perf_counter()
        key, status = self._cache_key(planned, context, use_cache, paginate=paginate)
        hit = self._cache.get(key) if key is not None and self._cache is not None else None
        return _Execution(planned, key, status, started, paginate, hit)

    def _complete(self, execution: _Execution, rows: ResultRows) -> DatasetQueryResult:
        """Cache freshly executed rows, then shape them."""

        if execution.key is not None and self._cache is not None:
            # Copy each row: an executor may hand back lists, and a cached entry
            # must not share anything mutable with the caller that filled it.
            frozen = tuple(tuple(row) for row in rows.rows)
            self._cache.put(execution.key, CachedRows(tuple(rows.columns), frozen))
        return self._finish(execution, rows, execution.status)

    @staticmethod
    def _finish(execution: _Execution, rows: ResultRows, status: CacheStatus) -> DatasetQueryResult:
        planned = execution.planned
        return build_result(
            rows,
            planned.compiled.query_id,
            (time.perf_counter() - execution.started) * 1000,
            status,
            query=planned.query if execution.paginate else None,
        )

    def to_sql(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
    ) -> str:
        """The redacted debug statement. Never executable, never carries a value."""

        return self._plan(target, query, context).compiled.to_sql()

    def validate(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
    ) -> ValidationResult:
        """Report whether *query* would plan without executing it."""

        try:
            self._plan(target, query, context)
        except CompiledQueryError as exc:
            if exc.category not in _INVALID_QUERY:
                raise
            return ValidationResult(valid=False, errors=(exc.message,))
        return ValidationResult(valid=True)


class _TenantBoundBase:
    """Planning methods of a client bound to one tenant capability.

    It has no public executor, cache, or unbound client, so code holding one
    can only run semantic queries, and only as the bound tenant. The binding is
    fixed at creation: neither the tenant nor the client can be reassigned.
    """

    __slots__ = ("_client", "_scope")

    _client: _DatasetClientBase
    _scope: TenantScope

    def __init__(self, client: _DatasetClientBase, scope: TenantScope) -> None:
        object.__setattr__(self, "_client", client)
        object.__setattr__(self, "_scope", require_tenant_capability(scope))

    def __setattr__(self, name: str, value: object) -> NoReturn:
        raise AttributeError("a tenant-bound client cannot be rebound")

    def __delattr__(self, name: str) -> NoReturn:
        raise AttributeError("a tenant-bound client cannot be rebound")

    def to_sql(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
    ) -> str:
        """The redacted debug statement. Never executable, never carries a value."""

        return self._client.to_sql(target, query, context=bind_tenant(self._scope, context))

    def validate(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
    ) -> ValidationResult:
        """Report whether *query* would plan for the bound tenant."""

        return self._client.validate(target, query, context=bind_tenant(self._scope, context))


class TenantDatasetClient(_TenantBoundBase):
    """A synchronous client that runs every query as one tenant."""

    __slots__ = ()

    _client: DatasetClient

    def execute(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
        **options: Unpack[ExecuteOptions],
    ) -> DatasetQueryResult:
        """Plan and run *query* over *target* as the bound tenant."""

        bound = bind_tenant(self._scope, context)
        return self._client.execute(target, query, context=bound, **options)


class AsyncTenantDatasetClient(_TenantBoundBase):
    """An async client that runs every query as one tenant."""

    __slots__ = ()

    _client: AsyncDatasetClient

    async def execute(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
        **options: Unpack[ExecuteOptions],
    ) -> DatasetQueryResult:
        """Plan and run *query* over *target* as the bound tenant."""

        bound = bind_tenant(self._scope, context)
        return await self._client.execute(target, query, context=bound, **options)


class DatasetClient(_DatasetClientBase):
    """Synchronous client over a blocking executor."""

    __slots__ = ("_executor",)

    def __init__(
        self,
        executor: QueryExecutor,
        registry: DatasetRegistry | None = None,
        settings: QuerySettings = DEFAULT_QUERY_SETTINGS,
        cache: ResultCache | None = None,
        timezone: str = "UTC",
    ) -> None:
        super().__init__(registry, settings, cache, timezone)
        self._executor = executor

    def for_tenant(self, scope: TenantScope) -> TenantDatasetClient:
        """A client that runs every query as the tenant *scope* grants.

        Hand this, not the client, to request handlers: it cannot run as
        another tenant, as all tenants, or without a tenant.
        """

        return TenantDatasetClient(self, scope)

    def execute(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
        use_cache: bool = True,
        paginate: bool = False,
    ) -> DatasetQueryResult:
        """Plan and run *query* over *target*, from the cache when possible."""

        execution = self._start(target, query, context, use_cache=use_cache, paginate=paginate)
        if execution.hit is not None:
            return self._finish(execution, execution.hit, "hit")
        return self._complete(execution, self._executor.execute(execution.planned.compiled))


class AsyncDatasetClient(_DatasetClientBase):
    """Async client over an executor that runs on the event loop.

    Cache stores are called synchronously. `MemoryCacheStore` never blocks the
    loop. A remote store should be fast or local to the process.
    """

    __slots__ = ("_executor",)

    def __init__(
        self,
        executor: AsyncQueryExecutor,
        registry: DatasetRegistry | None = None,
        settings: QuerySettings = DEFAULT_QUERY_SETTINGS,
        cache: ResultCache | None = None,
        timezone: str = "UTC",
    ) -> None:
        super().__init__(registry, settings, cache, timezone)
        self._executor = executor

    def for_tenant(self, scope: TenantScope) -> AsyncTenantDatasetClient:
        """An async client that runs every query as the tenant *scope* grants."""

        return AsyncTenantDatasetClient(self, scope)

    async def execute(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
        use_cache: bool = True,
        paginate: bool = False,
    ) -> DatasetQueryResult:
        """Plan and run *query* over *target*, from the cache when possible."""

        execution = self._start(target, query, context, use_cache=use_cache, paginate=paginate)
        if execution.hit is not None:
            return self._finish(execution, execution.hit, "hit")
        rows = await self._executor.execute(execution.planned.compiled)
        return self._complete(execution, rows)


def create_dataset_client(
    *,
    executor: QueryExecutor,
    registry: DatasetRegistry | None = None,
    settings: QuerySettings = DEFAULT_QUERY_SETTINGS,
    cache: ResultCache | None = None,
    timezone: str = "UTC",
) -> DatasetClient:
    """Create a synchronous dataset client.

    *registry* resolves datasets by name and the targets of relationships. It
    is optional for a client that only queries dataset objects without joins.
    *cache* enables result caching; without it every call executes. The client
    does not own *executor*; close it when the application stops.
    """

    return DatasetClient(executor, registry, settings, cache, timezone)


def create_async_dataset_client(
    *,
    executor: AsyncQueryExecutor,
    registry: DatasetRegistry | None = None,
    settings: QuerySettings = DEFAULT_QUERY_SETTINGS,
    cache: ResultCache | None = None,
    timezone: str = "UTC",
) -> AsyncDatasetClient:
    """Create an async dataset client. See `create_dataset_client`."""

    return AsyncDatasetClient(executor, registry, settings, cache, timezone)
