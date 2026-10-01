"""PYC-03: the tenant capability (RFC 0009).

A tenant scope is an opaque, server-created value. Nothing but its factories
can make one, it cannot be serialized, and printing it shows no tenant. A
tenant-bound client runs every query as one tenant and exposes nothing else.
"""

from __future__ import annotations

import asyncio
import copy
import pickle
from dataclasses import dataclass, field

import pytest

from hypequery.datasets import (
    AsyncTenantDatasetClient,
    CompiledQuery,
    CompiledQueryError,
    Dataset,
    DatasetQuery,
    ExecutionContext,
    TenantDatasetClient,
    all_tenants,
    count,
    create_async_dataset_client,
    create_dataset_client,
    dimension,
    eq,
    measure,
    plan_dataset_query,
    tenant,
    tenants,
)
from hypequery.datasets.client import ResultScalar
from hypequery.datasets.planner import Deadline, TenantScope


@dataclass(frozen=True)
class _Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


@dataclass
class _Executor:
    seen: list[CompiledQuery] = field(default_factory=list)

    def execute(self, compiled: CompiledQuery) -> _Rows:
        self.seen.append(compiled)
        return _Rows(("trips",), ((1,),))


@dataclass
class _AsyncExecutor:
    inner: _Executor = field(default_factory=_Executor)

    async def execute(self, compiled: CompiledQuery) -> _Rows:
        return self.inner.execute(compiled)


def _trips() -> Dataset:
    return Dataset(
        name="trips",
        source="analytics.trips",
        tenant_key="org_id",
        dimensions={"vendor": dimension("string")},
        measures={"trips": measure(count("id"))},
    )


QUERY = DatasetQuery(measures=("trips",))


# --- the capability itself ------------------------------------------------


def test_only_the_factories_create_a_scope() -> None:
    with pytest.raises(TypeError):
        TenantScope(object(), ("acme",), False)
    with pytest.raises(TypeError):
        TenantScope(ids=("acme",), cross_tenant=True)  # type: ignore[call-arg]


def test_a_scope_cannot_be_subclassed_around_the_seal() -> None:
    with pytest.raises(TypeError):

        class _Forged(TenantScope):  # pyright: ignore[reportUnusedClass]
            pass


def test_a_scope_is_immutable() -> None:
    scope = tenant("acme")
    with pytest.raises(AttributeError):
        scope._ids = ("globex",)
    with pytest.raises(AttributeError):
        scope._cross_tenant = True
    assert scope.ids == ("acme",)
    assert not scope.cross_tenant


def test_a_scope_cannot_be_serialized() -> None:
    for scope in (tenant("acme"), all_tenants()):
        with pytest.raises(TypeError):
            pickle.dumps(scope)
        with pytest.raises(TypeError):
            pickle.dumps(ExecutionContext(tenant=scope))


def test_copying_a_scope_returns_the_same_capability() -> None:
    scope = tenant("acme")
    assert copy.copy(scope) is scope
    assert copy.deepcopy(scope) is scope
    assert copy.deepcopy(ExecutionContext(tenant=scope)).tenant is scope


def test_printing_a_scope_or_context_shows_no_tenant() -> None:
    context = ExecutionContext(tenant=tenants(("acme-secret", "globex-secret")))
    for text in (repr(context.tenant), str(context.tenant), repr(context)):
        assert "secret" not in text
    assert repr(tenant("acme")) == "TenantScope(1 tenant)"
    assert repr(all_tenants()) == "TenantScope(all tenants)"


def test_a_tenant_set_is_a_set() -> None:
    assert tenants(("a", "b")) == tenants(("b", "a"))
    assert hash(tenants(("a", "b"))) == hash(tenants(("b", "a")))
    assert tenant("a") != tenant("b")
    assert tenant("a") != all_tenants()


@pytest.mark.parametrize("identifiers", [["acme"], ("acme", ""), ("acme", 1), ()])
def test_a_tenant_set_rejects_anything_but_a_tuple_of_names(identifiers: object) -> None:
    with pytest.raises(CompiledQueryError):
        tenants(identifiers)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "forged",
    [
        {"ids": ["acme"]},
        {"mode": "all"},
        "acme",
        ("acme",),
        type("Duck", (), {"ids": ("acme",), "cross_tenant": True})(),
    ],
)
def test_a_context_refuses_anything_but_a_capability(forged: object) -> None:
    with pytest.raises(CompiledQueryError) as caught:
        ExecutionContext(tenant=forged)  # type: ignore[arg-type]
    assert caught.value.category == "forbidden"
    assert caught.value.code == "HQ_CAPABILITY_CLASS_MISMATCH"
    assert "code" not in caught.value.failure.to_data()


def test_a_missing_tenant_carries_its_stable_code() -> None:
    with pytest.raises(CompiledQueryError) as caught:
        plan_dataset_query(_trips(), QUERY)
    assert caught.value.category == "tenant-required"
    assert caught.value.code == "HQ_CAPABILITY_TENANT_REQUIRED"
    assert caught.value.failure.to_data() == {
        "category": "tenant-required",
        "message": 'Dataset "trips" requires runtime tenant scoping.',
    }


# --- the tenant-bound client ----------------------------------------------


def test_a_bound_client_runs_as_its_tenant() -> None:
    executor = _Executor()
    scoped = create_dataset_client(executor=executor).for_tenant(tenant("acme"))

    scoped.execute(_trips(), QUERY)

    assert executor.seen[0].parameter_values() == {"p0": "acme"}


def test_a_bound_client_keeps_the_rest_of_the_context() -> None:
    executor = _Executor()
    scoped = create_dataset_client(executor=executor).for_tenant(tenant("acme"))
    deadline = Deadline.after(5)

    scoped.execute(
        _trips(), QUERY, context=ExecutionContext(deadline=deadline, correlation_id="req-1")
    )

    compiled = executor.seen[0]
    assert compiled.parameter_values() == {"p0": "acme"}
    assert compiled.correlation_id == "req-1"
    assert compiled.deadline is not None
    assert compiled.deadline.monotonic_at <= deadline.monotonic_at


def test_a_bound_client_accepts_its_own_tenant_in_the_context() -> None:
    executor = _Executor()
    scoped = create_dataset_client(executor=executor).for_tenant(tenant("a"))

    scoped.execute(_trips(), QUERY, context=ExecutionContext(tenant=tenants(("a",))))

    assert len(executor.seen) == 1
    assert executor.seen[0].parameter_values() == {"p0": "a"}


@pytest.mark.parametrize("other", [tenant("globex"), tenants(("acme", "globex")), all_tenants()])
def test_a_bound_client_refuses_another_tenant(other: TenantScope) -> None:
    executor = _Executor()
    scoped = create_dataset_client(executor=executor).for_tenant(tenant("acme"))
    context = ExecutionContext(tenant=other)

    for call in (scoped.execute, scoped.to_sql, scoped.validate):
        with pytest.raises(CompiledQueryError) as caught:
            call(_trips(), QUERY, context=context)
        assert caught.value.category == "forbidden"
        assert caught.value.code == "HQ_CAPABILITY_TENANT_MISMATCH"
    assert executor.seen == []


def test_binding_requires_a_named_tenant_capability() -> None:
    client = create_dataset_client(executor=_Executor())

    with pytest.raises(CompiledQueryError) as missing:
        client.for_tenant(None)  # type: ignore[arg-type]
    assert missing.value.code == "HQ_CAPABILITY_MISSING"

    for wrong in (all_tenants(), tenants(("acme", "globex")), {"ids": ["acme"]}, "acme"):
        with pytest.raises(CompiledQueryError) as mismatch:
            client.for_tenant(wrong)  # type: ignore[arg-type]
        assert mismatch.value.category == "forbidden"
        assert mismatch.value.code == "HQ_CAPABILITY_CLASS_MISMATCH"


def test_direct_bound_client_construction_enforces_the_same_scope_check() -> None:
    sync_client = create_dataset_client(executor=_Executor())
    async_client = create_async_dataset_client(executor=_AsyncExecutor())

    for wrong in (None, all_tenants(), tenants(("acme", "globex"))):
        with pytest.raises(CompiledQueryError):
            TenantDatasetClient(sync_client, wrong)  # type: ignore[arg-type]
        with pytest.raises(CompiledQueryError):
            AsyncTenantDatasetClient(async_client, wrong)  # type: ignore[arg-type]

    scoped = TenantDatasetClient(sync_client, tenant("acme"))
    scoped.execute(_trips(), QUERY)


def test_a_bound_client_exposes_only_semantic_queries() -> None:
    sync_scoped = create_dataset_client(executor=_Executor()).for_tenant(tenant("acme"))
    async_scoped = create_async_dataset_client(executor=_AsyncExecutor()).for_tenant(tenant("acme"))

    for scoped in (sync_scoped, async_scoped):
        public = {name for name in dir(scoped) if not name.startswith("_")}
        assert public == {"execute", "to_sql", "validate"}


def test_an_async_bound_client_runs_as_its_tenant() -> None:
    executor = _AsyncExecutor()
    scoped = create_async_dataset_client(executor=executor).for_tenant(tenant("acme"))

    asyncio.run(scoped.execute(_trips(), QUERY))
    with pytest.raises(CompiledQueryError) as caught:
        asyncio.run(
            scoped.execute(_trips(), QUERY, context=ExecutionContext(tenant=tenant("globex")))
        )

    assert executor.inner.seen[0].parameter_values() == {"p0": "acme"}
    assert len(executor.inner.seen) == 1
    assert caught.value.code == "HQ_CAPABILITY_TENANT_MISMATCH"


# --- security review follow-ups -------------------------------------------


def test_a_scope_exposes_no_state_to_serializers() -> None:
    with pytest.raises(TypeError):
        tenant("acme").__getstate__()


def test_a_compiled_query_repr_shows_no_sql_or_bound_value() -> None:
    compiled = plan_dataset_query(
        _trips(),
        DatasetQuery(measures=("trips",), filters=(eq("vendor", "filter-secret"),)),
        context=ExecutionContext(tenant=tenant("tenant-secret")),
    )

    for text in (repr(compiled), str(compiled), repr(compiled.parameters)):
        assert "secret" not in text
    assert "analytics" not in repr(compiled)
    assert "SELECT" not in repr(compiled)
    assert "'p1': 'String'" in repr(compiled)
    assert compiled.parameter_values() == {"p0": "filter-secret", "p1": "tenant-secret"}


def test_a_bound_client_cannot_be_rebound() -> None:
    executor = _Executor()
    scoped = create_dataset_client(executor=executor).for_tenant(tenant("acme"))

    with pytest.raises(AttributeError):
        scoped._scope = tenant("globex")
    with pytest.raises(AttributeError):
        scoped._client = create_dataset_client(executor=_Executor())
    with pytest.raises(AttributeError):
        del scoped._scope

    scoped.execute(_trips(), QUERY)
    assert executor.seen[0].parameter_values() == {"p0": "acme"}


def test_the_planner_refuses_a_look_alike_that_skipped_the_context_check() -> None:
    @dataclass(frozen=True)
    class _LookAlike:
        ids: tuple[str, ...] = ()
        cross_tenant: bool = True

    context = object.__new__(ExecutionContext)
    for name, value in (
        ("tenant", _LookAlike()),
        ("deadline", None),
        ("cancellation", None),
        ("correlation_id", None),
    ):
        object.__setattr__(context, name, value)

    with pytest.raises(CompiledQueryError) as caught:
        plan_dataset_query(_trips(), QUERY, context=context)
    assert caught.value.category == "forbidden"
    assert caught.value.code == "HQ_CAPABILITY_CLASS_MISMATCH"
