"""Dataset clients: plan a semantic query, execute it, key the rows.

`create_dataset_client` is the canonical entry point, as `createDatasetClient`
is in TypeScript. The planner stays the only thing that builds SQL; a client
adds target resolution, request validation, result caching, and result shaping
around it.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from ..cache import CachedRows, ResultCache
from ..dataset import Dataset
from ..planner import (
    DEFAULT_QUERY_SETTINGS,
    CompiledQuery,
    CompiledQueryError,
    DatasetQuery,
    ExecutionContext,
    QuerySettings,
    plan_dataset_query,
)
from ..registry import DatasetRegistry
from .inputs import DatasetTarget, QueryInput, coerce_query, resolve_dataset
from .results import (
    AsyncQueryExecutor,
    CacheStatus,
    DatasetQueryResult,
    QueryExecutor,
    ResultRows,
    ValidationResult,
    build_result,
)

#: Failures that mean "this query would not plan", as opposed to "this call
#: should not run now". A cancelled or expired context is the second kind and
#: is raised from `validate` rather than reported as an invalid query.
_INVALID_QUERY = frozenset(("input-invalid", "not-found", "too-large", "tenant-required"))


@dataclass(frozen=True, slots=True)
class _Planned:
    dataset: Dataset
    query: DatasetQuery
    compiled: CompiledQuery


class _DatasetClientBase:
    __slots__ = ("_cache", "_registry", "_settings")

    def __init__(
        self,
        registry: DatasetRegistry | None,
        settings: QuerySettings,
        cache: ResultCache | None,
    ) -> None:
        self._registry = registry
        self._settings = settings
        self._cache = cache

    def _plan(
        self, target: DatasetTarget, query: QueryInput, context: ExecutionContext | None
    ) -> _Planned:
        dataset = resolve_dataset(target, self._registry)
        semantic = coerce_query(query)
        compiled = plan_dataset_query(
            dataset, semantic, registry=self._registry, context=context, settings=self._settings
        )
        return _Planned(dataset, semantic, compiled)

    def _cache_key(
        self, planned: _Planned, context: ExecutionContext | None, use_cache: bool
    ) -> tuple[str | None, CacheStatus]:
        # Planning ran first, so a request that fails admission, tenant
        # resolution, or validation never reaches the cache.
        if self._cache is None:
            return None, "off"
        if not use_cache:
            return None, "bypass"
        key = self._cache.key_for(planned.dataset, planned.query, context, self._registry)
        return key, ("miss" if key is not None else "bypass")

    def _cached(self, key: str | None) -> CachedRows | None:
        if key is None or self._cache is None:
            return None
        return self._cache.get(key)

    def _remember(self, key: str | None, rows: ResultRows) -> None:
        if key is not None and self._cache is not None:
            # Copy each row: an executor may hand back lists, and a cached entry
            # must not share anything mutable with the caller that filled it.
            frozen = tuple(tuple(row) for row in rows.rows)
            self._cache.put(key, CachedRows(tuple(rows.columns), frozen))

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


class DatasetClient(_DatasetClientBase):
    """Synchronous client over a blocking executor."""

    __slots__ = ("_executor",)

    def __init__(
        self,
        executor: QueryExecutor,
        registry: DatasetRegistry | None = None,
        settings: QuerySettings = DEFAULT_QUERY_SETTINGS,
        cache: ResultCache | None = None,
    ) -> None:
        super().__init__(registry, settings, cache)
        self._executor = executor

    def execute(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
        use_cache: bool = True,
    ) -> DatasetQueryResult:
        """Plan and run *query* over *target*, from the cache when possible."""

        planned = self._plan(target, query, context)
        started = time.perf_counter()
        key, status = self._cache_key(planned, context, use_cache)
        hit = self._cached(key)
        if hit is not None:
            elapsed = (time.perf_counter() - started) * 1000
            return build_result(hit, planned.compiled.query_id, elapsed, "hit")
        rows = self._executor.execute(planned.compiled)
        self._remember(key, rows)
        elapsed = (time.perf_counter() - started) * 1000
        return build_result(rows, planned.compiled.query_id, elapsed, status)


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
    ) -> None:
        super().__init__(registry, settings, cache)
        self._executor = executor

    async def execute(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
        use_cache: bool = True,
    ) -> DatasetQueryResult:
        """Plan and run *query* over *target*, from the cache when possible."""

        planned = self._plan(target, query, context)
        started = time.perf_counter()
        key, status = self._cache_key(planned, context, use_cache)
        hit = self._cached(key)
        if hit is not None:
            elapsed = (time.perf_counter() - started) * 1000
            return build_result(hit, planned.compiled.query_id, elapsed, "hit")
        rows = await self._executor.execute(planned.compiled)
        self._remember(key, rows)
        elapsed = (time.perf_counter() - started) * 1000
        return build_result(rows, planned.compiled.query_id, elapsed, status)


def create_dataset_client(
    *,
    executor: QueryExecutor,
    registry: DatasetRegistry | None = None,
    settings: QuerySettings = DEFAULT_QUERY_SETTINGS,
    cache: ResultCache | None = None,
) -> DatasetClient:
    """Create a synchronous dataset client.

    *registry* resolves datasets by name and the targets of relationships. It
    is optional for a client that only queries dataset objects without joins.
    *cache* enables result caching; without it every call executes. The client
    does not own *executor*; close it when the application stops.
    """

    return DatasetClient(executor, registry, settings, cache)


def create_async_dataset_client(
    *,
    executor: AsyncQueryExecutor,
    registry: DatasetRegistry | None = None,
    settings: QuerySettings = DEFAULT_QUERY_SETTINGS,
    cache: ResultCache | None = None,
) -> AsyncDatasetClient:
    """Create an async dataset client. See `create_dataset_client`."""

    return AsyncDatasetClient(executor, registry, settings, cache)
