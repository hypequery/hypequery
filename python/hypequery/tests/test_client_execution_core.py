"""The shared client core: page sizing, option forwarding and cache observability."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

import pytest

from hypequery.datasets import (
    CompiledQuery,
    CompiledQueryError,
    Dataset,
    DatasetQuery,
    MemoryCacheStore,
    ResultCache,
    create_async_dataset_client,
    create_dataset_client,
    dimension,
    gt,
    measure,
    tenant,
)
from hypequery.datasets.cache import CachedRows, CacheStage
from hypequery.datasets.client import DEFAULT_PAGE_SIZE, ResultScalar
from hypequery.datasets.client.pagination import page_limit


@pytest.mark.parametrize(
    ("requested", "cap", "max_rows", "expected"),
    [
        (None, None, 100_000, DEFAULT_PAGE_SIZE),
        (None, 50, 100_000, 50),
        (None, 5_000, 100_000, DEFAULT_PAGE_SIZE),
        (25, None, 100_000, 25),
        (5_000, None, 100_000, 5_000),
        (500, None, 101, 100),
        (None, None, 2, 1),
    ],
)
def test_page_limit(requested: int | None, cap: int | None, max_rows: int, expected: int) -> None:
    assert page_limit(requested, cap, max_rows) == expected


def test_page_limit_needs_room_for_the_probe_row() -> None:
    with pytest.raises(CompiledQueryError) as caught:
        page_limit(10, None, 1)
    assert caught.value.category == "too-large"


@dataclass(frozen=True)
class _Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


@dataclass
class _Executor:
    calls: list[CompiledQuery] = field(default_factory=list)

    def execute(self, compiled: CompiledQuery) -> _Rows:
        self.calls.append(compiled)
        return _Rows(("trips",), ((1,),))


@dataclass
class _AsyncExecutor:
    inner: _Executor = field(default_factory=_Executor)

    async def execute(self, compiled: CompiledQuery) -> _Rows:
        return self.inner.execute(compiled)


TRIPS = Dataset(
    name="trips",
    source="trips",
    tenant_key="org_id",
    dimensions={"vendor": dimension.string()},
    measures={"trips": measure.count("vendor")},
)
QUERY = DatasetQuery(measures=("trips",))


def _cache(**options: object) -> ResultCache:
    return ResultCache(store=MemoryCacheStore(), ttl_seconds=60, **options)  # type: ignore[arg-type]


def test_tenant_clients_forward_every_execute_option() -> None:
    executor, async_executor = _Executor(), _AsyncExecutor()
    sync_scoped = create_dataset_client(executor=executor, cache=_cache()).for_tenant(
        tenant("acme")
    )
    async_scoped = create_async_dataset_client(executor=async_executor, cache=_cache()).for_tenant(
        tenant("acme")
    )

    first = sync_scoped.execute(TRIPS, QUERY)
    cached = sync_scoped.execute(TRIPS, QUERY)
    bypassed = sync_scoped.execute(TRIPS, QUERY, use_cache=False)
    async_first = asyncio.run(async_scoped.execute(TRIPS, QUERY))
    async_bypassed = asyncio.run(async_scoped.execute(TRIPS, QUERY, use_cache=False))

    assert [first.meta.cache, cached.meta.cache, bypassed.meta.cache] == ["miss", "hit", "bypass"]
    assert [async_first.meta.cache, async_bypassed.meta.cache] == ["miss", "bypass"]
    assert len(executor.calls) == 2
    assert len(async_executor.inner.calls) == 2


class _BrokenStore:
    def get(self, key: str) -> CachedRows | None:
        raise ConnectionError("redis://user:secret@cache:6379")

    def set(self, key: str, value: CachedRows, ttl_seconds: float) -> None:
        raise ConnectionError("redis://user:secret@cache:6379")


def test_cache_failures_reach_the_hook_and_never_fail_the_query() -> None:
    seen: list[tuple[CacheStage, str]] = []

    def on_error(stage: CacheStage, error: Exception) -> None:
        seen.append((stage, type(error).__name__))
        raise RuntimeError("a broken hook is ignored too")

    cache = ResultCache(store=_BrokenStore(), ttl_seconds=60, secret=b"s" * 32, on_error=on_error)
    scoped = create_dataset_client(executor=_Executor(), cache=cache).for_tenant(tenant("acme"))
    result = scoped.execute(TRIPS, QUERY)

    assert result.meta.cache == "miss"
    assert seen == [("get", "ConnectionError"), ("put", "ConnectionError")]


def test_cache_failures_without_a_hook_log_the_type_only(caplog: pytest.LogCaptureFixture) -> None:
    cache = ResultCache(store=_BrokenStore(), ttl_seconds=60, secret=b"s" * 32)
    scoped = create_dataset_client(executor=_Executor(), cache=cache).for_tenant(tenant("acme"))

    with caplog.at_level(logging.DEBUG, logger="hypequery.datasets.cache.result_cache"):
        scoped.execute(TRIPS, QUERY)

    assert "Result cache get failed: ConnectionError" in caplog.text
    assert "secret" not in caplog.text


def test_an_unkeyable_query_reports_the_key_stage_and_runs_uncached() -> None:
    seen: list[CacheStage] = []
    cache = _cache(on_error=lambda stage, error: seen.append(stage))
    fares = Dataset(
        name="fares",
        source="fares",
        dimensions={"fare": dimension.number()},
        measures={"rides": measure.count("fare")},
    )
    # The planner binds any finite number; the RFC 0009 preimage has no exact
    # spelling for an integer beyond 2**53, so this execution cannot be keyed.
    query = DatasetQuery(measures=("rides",), filters=(gt("fare", 2**60),))

    result = create_dataset_client(executor=_Executor(), cache=cache).execute(fares, query)

    assert result.meta.cache == "bypass"
    assert seen == ["key"]
