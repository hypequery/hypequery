"""PYC-04: the dataset result cache.

The properties pinned here are the ones RFC 0009 and RFC 0013 exist for:
- two tenants never share an entry;
- equivalent requests do share one;
- a store only ever sees opaque keys;
- a cache failure never fails a query.
"""

from __future__ import annotations

import asyncio
import re
import warnings
from dataclasses import dataclass, field

import pytest

from hypequery.datasets import (
    CachedRows,
    CompiledQuery,
    CompiledQueryError,
    Dataset,
    DatasetQuery,
    ExecutionContext,
    MemoryCacheStore,
    ResultCache,
    all_tenants,
    between,
    count,
    create_async_dataset_client,
    create_dataset_client,
    dimension,
    eq,
    gt,
    measure,
    tenant,
)
from hypequery.datasets.client import ResultScalar
from hypequery.protocol import ProtocolCacheKeyError

SECRET = bytes([0x5A]) * 32
KEY = re.compile(r"hq1\.1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\Z")


@dataclass(frozen=True)
class _Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


@dataclass
class _Executor:
    calls: list[CompiledQuery] = field(default_factory=list)

    def execute(self, compiled: CompiledQuery) -> _Rows:
        self.calls.append(compiled)
        return _Rows(("vendor", "trips"), (("a", len(self.calls)),))


@dataclass
class _RecordingStore:
    inner: MemoryCacheStore = field(default_factory=MemoryCacheStore)
    keys: list[str] = field(default_factory=list)
    values: list[CachedRows] = field(default_factory=list)

    def get(self, key: str) -> CachedRows | None:
        self.keys.append(key)
        return self.inner.get(key)

    def set(self, key: str, value: CachedRows, ttl_seconds: float) -> None:
        self.keys.append(key)
        self.values.append(value)
        self.inner.set(key, value, ttl_seconds)


class _BrokenStore:
    def get(self, key: str) -> CachedRows | None:
        raise ConnectionError("store down")

    def set(self, key: str, value: CachedRows, ttl_seconds: float) -> None:
        raise ConnectionError("store down")


def _trips(*, tenant_key: str | None = "org_id", source: str = "analytics.trips") -> Dataset:
    return Dataset(
        name="trips",
        source=source,
        tenant_key=tenant_key,
        dimensions={"vendor": dimension("string"), "fare": dimension("number")},
        measures={"trips": measure(count("id"))},
    )


def _cache(store: object | None = None, **overrides: object) -> ResultCache:
    options: dict[str, object] = {
        "store": store if store is not None else MemoryCacheStore(),
        "secret": SECRET,
        "project": "acme",
        "environment": "production",
        "ttl_seconds": 60,
        **overrides,
    }
    return ResultCache(**options)  # type: ignore[arg-type]


QUERY = DatasetQuery(dimensions=("vendor",), measures=("trips",))
AS_ACME = ExecutionContext(tenant=tenant("acme"))
AS_GLOBEX = ExecutionContext(tenant=tenant("globex"))


def test_a_repeat_query_is_served_from_the_cache() -> None:
    executor = _Executor()
    client = create_dataset_client(executor=executor, cache=_cache())

    first = client.execute(_trips(), QUERY, context=AS_ACME)
    second = client.execute(_trips(), QUERY, context=AS_ACME)

    assert (first.meta.cache, second.meta.cache) == ("miss", "hit")
    assert second.data == first.data
    assert len(executor.calls) == 1
    # Every call keeps its own authoritative query ID, hit or not.
    assert second.meta.query_id != first.meta.query_id


def test_two_tenants_never_share_an_entry() -> None:
    executor = _Executor()
    client = create_dataset_client(executor=executor, cache=_cache())

    acme = client.execute(_trips(), QUERY, context=AS_ACME)
    globex = client.execute(_trips(), QUERY, context=AS_GLOBEX)

    assert (acme.meta.cache, globex.meta.cache) == ("miss", "miss")
    assert len(executor.calls) == 2
    assert acme.data != globex.data


def test_tenant_free_scoped_and_all_tenant_executions_never_share() -> None:
    executor = _Executor()
    client = create_dataset_client(executor=executor, cache=_cache())
    dataset = _trips(tenant_key=None)

    for context in (None, AS_ACME, ExecutionContext(tenant=all_tenants())):
        assert client.execute(dataset, QUERY, context=context).meta.cache == "miss"
    assert len(executor.calls) == 3


def test_equivalent_requests_share_an_entry() -> None:
    executor = _Executor()
    client = create_dataset_client(executor=executor, cache=_cache())
    one, two = eq("vendor", "a"), gt("fare", 10)

    client.execute(_trips(), DatasetQuery(measures=("trips",), filters=(one, two)), context=AS_ACME)
    reordered = client.execute(
        _trips(),
        {"measures": ["trips"], "filters": [two, one], "offset": 0},
        context=AS_ACME,
    )

    assert reordered.meta.cache == "hit"
    assert len(executor.calls) == 1


def test_a_store_only_ever_sees_opaque_keys() -> None:
    store = _RecordingStore()
    client = create_dataset_client(executor=_Executor(), cache=_cache(store))

    client.execute(
        _trips(),
        DatasetQuery(measures=("trips",), filters=(eq("vendor", "secret-vendor"),)),
        context=ExecutionContext(tenant=tenant("tenant-marker")),
    )

    assert store.keys
    for key in store.keys:
        assert KEY.match(key)
        for fragment in ("secret-vendor", "tenant-marker", "analytics", "trips", "vendor"):
            assert fragment not in key
    assert store.values == [CachedRows(("vendor", "trips"), (("a", 1),))]


def test_a_failing_store_never_fails_a_query() -> None:
    executor = _Executor()
    client = create_dataset_client(executor=executor, cache=_cache(_BrokenStore()))

    for _ in range(2):
        assert client.execute(_trips(), QUERY, context=AS_ACME).data == (
            {"vendor": "a", "trips": len(executor.calls)},
        )
    assert len(executor.calls) == 2


def test_use_cache_false_bypasses_without_touching_the_store() -> None:
    store = _RecordingStore()
    client = create_dataset_client(executor=_Executor(), cache=_cache(store))

    result = client.execute(_trips(), QUERY, context=AS_ACME, use_cache=False)

    assert result.meta.cache == "bypass"
    assert store.keys == []


def test_a_query_with_no_portable_form_runs_uncached() -> None:
    executor = _Executor()
    client = create_dataset_client(executor=executor, cache=_cache())
    unportable = DatasetQuery(measures=("trips",), filters=(eq("fare", 2**60),))

    first = client.execute(_trips(), unportable, context=AS_ACME)
    second = client.execute(_trips(), unportable, context=AS_ACME)

    assert (first.meta.cache, second.meta.cache) == ("bypass", "bypass")
    assert len(executor.calls) == 2


def test_integer_and_between_filters_are_cacheable() -> None:
    executor = _Executor()
    client = create_dataset_client(executor=executor, cache=_cache())
    query = DatasetQuery(measures=("trips",), filters=(eq("fare", 5), between("fare", 1, 9)))

    client.execute(_trips(), query, context=AS_ACME)
    assert client.execute(_trips(), query, context=AS_ACME).meta.cache == "hit"


def test_a_request_that_fails_planning_never_reaches_the_store() -> None:
    store = _RecordingStore()
    client = create_dataset_client(executor=_Executor(), cache=_cache(store))

    with pytest.raises(CompiledQueryError) as caught:
        client.execute(_trips(), QUERY)

    assert caught.value.category == "tenant-required"
    assert store.keys == []


def test_changing_a_definition_invalidates_its_entries() -> None:
    store = MemoryCacheStore()
    executor = _Executor()
    create_dataset_client(executor=executor, cache=_cache(store)).execute(
        _trips(), QUERY, context=AS_ACME
    )

    moved = create_dataset_client(executor=executor, cache=_cache(store)).execute(
        _trips(source="analytics.trips_v2"), QUERY, context=AS_ACME
    )

    assert moved.meta.cache == "miss"


def test_a_shared_definition_identity_shares_entries_across_clients() -> None:
    store = MemoryCacheStore()
    identity = "d" * 64
    executor = _Executor()
    for _ in range(2):
        create_dataset_client(
            executor=executor, cache=_cache(store, definition_identity=identity)
        ).execute(_trips(), QUERY, context=AS_ACME)

    assert len(executor.calls) == 1


def test_mutating_a_result_cannot_change_a_later_hit() -> None:
    client = create_dataset_client(executor=_Executor(), cache=_cache())

    first = client.execute(_trips(), QUERY, context=AS_ACME)
    first.data[0]["trips"] = 999

    assert client.execute(_trips(), QUERY, context=AS_ACME).data == ({"vendor": "a", "trips": 1},)


def test_the_async_client_shares_the_same_cache_rules() -> None:
    inner = _Executor()

    @dataclass
    class _Async:
        async def execute(self, compiled: CompiledQuery) -> _Rows:
            return inner.execute(compiled)

    client = create_async_dataset_client(executor=_Async(), cache=_cache())

    async def run() -> tuple[str, str]:
        first = await client.execute(_trips(), QUERY, context=AS_ACME)
        second = await client.execute(_trips(), QUERY, context=AS_ACME)
        return first.meta.cache, second.meta.cache

    assert asyncio.run(run()) == ("miss", "hit")
    assert len(inner.calls) == 1


@pytest.mark.parametrize(
    ("overrides", "error"),
    [
        ({"secret": b"short"}, ProtocolCacheKeyError),
        ({"secret": b""}, ProtocolCacheKeyError),
        ({"project": "has space"}, ProtocolCacheKeyError),
        ({"key_version": 0}, ProtocolCacheKeyError),
        ({"ttl_seconds": 0}, ValueError),
        ({"ttl_seconds": float("inf")}, ValueError),
        ({"definition_identity": "not-hex"}, ValueError),
    ],
)
def test_a_misconfigured_cache_fails_at_construction(
    overrides: dict[str, object], error: type[Exception]
) -> None:
    with pytest.raises(error):
        _cache(**overrides)


def test_the_secret_stays_out_of_repr() -> None:
    assert SECRET.hex() not in repr(_cache())
    assert repr(SECRET) not in repr(_cache())


def test_memory_store_expires_and_evicts(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [1_000.0]
    monkeypatch.setattr("hypequery.datasets.cache.store.time.monotonic", lambda: now[0])
    store = MemoryCacheStore(max_entries=2)
    rows = CachedRows(("a",), ((1,),))

    store.set("k1", rows, 10)
    store.set("k2", rows, 10)
    assert store.get("k1") == rows  # k1 is now most recently used
    store.set("k3", rows, 10)
    assert store.get("k2") is None  # the least recently used entry was evicted
    assert store.get("k1") == rows

    now[0] += 11
    assert store.get("k1") is None
    assert len(store) == 1  # k3 is expired too but not yet swept


def test_without_a_secret_the_cache_still_works_and_stays_opaque() -> None:
    store = _RecordingStore()
    executor = _Executor()
    with pytest.warns(UserWarning, match="no secret"):
        cache = _cache(store, secret=None)
    client = create_dataset_client(executor=executor, cache=cache)

    first = client.execute(_trips(), QUERY, context=AS_ACME)
    second = client.execute(_trips(), QUERY, context=AS_ACME)

    assert (first.meta.cache, second.meta.cache) == ("miss", "hit")
    assert all(KEY.match(key) and "acme" not in key for key in store.keys)


def test_caches_without_a_secret_never_share_entries() -> None:
    store = MemoryCacheStore()
    executor = _Executor()
    for _ in range(2):
        create_dataset_client(executor=executor, cache=_cache(store, secret=None)).execute(
            _trips(), QUERY, context=AS_ACME
        )

    # Each generated its own secret, so the second could not address the
    # first's entry: safe, just unshared.
    assert len(executor.calls) == 2


def test_a_memory_store_without_a_secret_does_not_warn() -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        _cache(secret=None)
