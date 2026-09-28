"""Dataset clients: plan a semantic query, execute it, key the rows.

`create_dataset_client` is the canonical entry point, as `createDatasetClient`
is in TypeScript. The planner stays the only thing that builds SQL; a client
adds target resolution, request validation, and result shaping around it.
"""

from __future__ import annotations

import time

from ..planner import (
    DEFAULT_QUERY_SETTINGS,
    CompiledQuery,
    CompiledQueryError,
    ExecutionContext,
    QuerySettings,
    plan_dataset_query,
)
from ..registry import DatasetRegistry
from .inputs import DatasetTarget, QueryInput, coerce_query, resolve_dataset
from .results import (
    AsyncQueryExecutor,
    DatasetQueryResult,
    QueryExecutor,
    ValidationResult,
    build_result,
)

#: Failures that mean "this query would not plan", as opposed to "this call
#: should not run now". A cancelled or expired context is the second kind and
#: is raised from `validate` rather than reported as an invalid query.
_INVALID_QUERY = frozenset(("input-invalid", "not-found", "too-large", "tenant-required"))


class _DatasetClientBase:
    __slots__ = ("_registry", "_settings")

    def __init__(self, registry: DatasetRegistry | None, settings: QuerySettings) -> None:
        self._registry = registry
        self._settings = settings

    def _plan(
        self, target: DatasetTarget, query: QueryInput, context: ExecutionContext | None
    ) -> CompiledQuery:
        return plan_dataset_query(
            resolve_dataset(target, self._registry),
            coerce_query(query),
            registry=self._registry,
            context=context,
            settings=self._settings,
        )

    def to_sql(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
    ) -> str:
        """The redacted debug statement. Never executable, never carries a value."""

        return self._plan(target, query, context).to_sql()

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
    ) -> None:
        super().__init__(registry, settings)
        self._executor = executor

    def execute(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
    ) -> DatasetQueryResult:
        """Plan and run *query* over *target*."""

        compiled = self._plan(target, query, context)
        started = time.perf_counter()
        rows = self._executor.execute(compiled)
        return build_result(rows, compiled.query_id, (time.perf_counter() - started) * 1000)


class AsyncDatasetClient(_DatasetClientBase):
    """Async client over an executor that runs on the event loop."""

    __slots__ = ("_executor",)

    def __init__(
        self,
        executor: AsyncQueryExecutor,
        registry: DatasetRegistry | None = None,
        settings: QuerySettings = DEFAULT_QUERY_SETTINGS,
    ) -> None:
        super().__init__(registry, settings)
        self._executor = executor

    async def execute(
        self,
        target: DatasetTarget,
        query: QueryInput = None,
        *,
        context: ExecutionContext | None = None,
    ) -> DatasetQueryResult:
        """Plan and run *query* over *target*."""

        compiled = self._plan(target, query, context)
        started = time.perf_counter()
        rows = await self._executor.execute(compiled)
        return build_result(rows, compiled.query_id, (time.perf_counter() - started) * 1000)


def create_dataset_client(
    *,
    executor: QueryExecutor,
    registry: DatasetRegistry | None = None,
    settings: QuerySettings = DEFAULT_QUERY_SETTINGS,
) -> DatasetClient:
    """Create a synchronous dataset client.

    *registry* resolves datasets by name and the targets of relationships. It
    is optional for a client that only queries dataset objects without joins.
    The client does not own *executor*; close it when the application stops.
    """

    return DatasetClient(executor, registry, settings)


def create_async_dataset_client(
    *,
    executor: AsyncQueryExecutor,
    registry: DatasetRegistry | None = None,
    settings: QuerySettings = DEFAULT_QUERY_SETTINGS,
) -> AsyncDatasetClient:
    """Create an async dataset client. See `create_dataset_client`."""

    return AsyncDatasetClient(executor, registry, settings)
