from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, cast

import pytest
from clickhouse_connect.driver.binding import bind_query
from clickhouse_connect.driver.exceptions import OperationalError, ProgrammingError
from clickhouse_connect.driver.models import SettingDef

from hypequery.datasets.planner import (
    DEFAULT_QUERY_SETTINGS,
    CompiledQuery,
    CompiledQueryError,
    QuerySettings,
    TypedParameter,
)
from hypequery.execution import (
    AsyncClickHouseExecutor,
    AsyncFromSyncClickHouseExecutor,
    ClickHouseConnection,
    ClickHouseExecutor,
    ReadonlyPolicy,
)
from hypequery.execution.results import DriverResult, decode_result


@dataclass
class Result:
    column_names: tuple[str, ...]
    result_rows: list[tuple[object, ...]]


class SyncClient:
    def __init__(self, result: Result | Exception) -> None:
        self.result = result
        self.calls: list[tuple[object, ...]] = []

    def query(self, *args: object, **kwargs: object) -> DriverResult:
        self.calls.append((args, kwargs))
        if isinstance(self.result, Exception):
            raise self.result
        return cast(DriverResult, self.result)


class AsyncClient(SyncClient):
    async def query(self, *args: object, **kwargs: object) -> DriverResult:  # type: ignore[override]
        return super().query(*args, **kwargs)


def compiled(value: object = "a'b\x00c", kind: str = "String") -> CompiledQuery:
    return CompiledQuery(
        sql="SELECT {p0:" + kind + "} AS value",
        parameters={"p0": TypedParameter("p0", kind, value)},
    )


@pytest.mark.parametrize(
    ("value", "kind", "wire"),
    [
        ("a'b\x00c", "String", "a'b\x00c"),
        (2**63 - 1, "Int64", 2**63 - 1),
        (2**64 - 1, "UInt64", 2**64 - 1),
        (Decimal("123456789.012345678"), "Decimal(27,9)", Decimal("123456789.012345678")),
        # An instant travels as Unix seconds: no server time zone can reread it.
        (datetime(2026, 10, 25, 1, 30, tzinfo=UTC), "DateTime64(3)", "1792891800.000000"),
    ],
)
def test_driver_uses_server_parameter_binding(value: object, kind: str, wire: object) -> None:
    query = compiled(value, kind)
    client = SyncClient(Result(("value",), [("ok",)]))
    result = ClickHouseExecutor(client).execute(query)
    assert result.named_rows() == ({"value": "ok"},)
    args, kwargs = cast(tuple[tuple[object, ...], dict[str, object]], client.calls[0])
    assert args[0] == query.sql
    assert args[1] == {"p0": wire}
    assert kwargs["transport_settings"] == {}
    assert cast(dict[str, object], args[2])["query_id"] == query.query_id
    assert kwargs["use_none"] is True
    assert kwargs["tz_mode"] == "aware"
    wire_sql, bound = bind_query(query.sql, cast(dict[str, object], args[1]))
    assert wire_sql == query.sql
    assert "param_p0" in bound
    assert str(value) not in wire_sql


def test_async_query_uses_same_boundary() -> None:
    query = compiled()
    client = AsyncClient(Result(("value",), [("ok",)]))

    class Control:
        async def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
            return "finished"

    result = asyncio.run(AsyncClickHouseExecutor(client, Control()).execute(query))
    assert result.named_rows() == ({"value": "ok"},)
    assert client.calls


@pytest.mark.parametrize(
    "query",
    [
        CompiledQuery("SELECT 1", {"p0": TypedParameter("p0", "String", "secret")}),
        CompiledQuery("SELECT {p0:String}", {"p0": TypedParameter("p0", "Int64", 3)}),
        CompiledQuery("SELECT {p0:String}", {"p0": TypedParameter("p0", "String", object())}),
        CompiledQuery("DELETE FROM t", {}),
        CompiledQuery("SELECT 1", {}, settings=QuerySettings({"readonly": 0})),
    ],
)
def test_invalid_query_never_reaches_driver(query: CompiledQuery) -> None:
    client = SyncClient(Result((), []))
    with pytest.raises(CompiledQueryError) as exc:
        ClickHouseExecutor(client).execute(query)
    assert exc.value.category == "internal"
    assert client.calls == []


def test_result_codec_is_closed() -> None:
    query = compiled()
    result = Result(
        ("number", "amount", "day", "at", "empty"),
        [(2**63, Decimal("1.25"), date(2026, 1, 2), datetime(2026, 1, 2, tzinfo=UTC), None)],
    )
    decoded = decode_result(cast(DriverResult, result), query.query_id)
    assert decoded.rows == ((2**63, "1.25", "2026-01-02", "2026-01-02T00:00:00+00:00", None),)
    with pytest.raises(CompiledQueryError):
        decode_result(cast(DriverResult, Result(("x",), [(object(),)])), query.query_id)
    with pytest.raises(CompiledQueryError):
        decode_result(cast(DriverResult, Result(("x", "x"), [])), query.query_id)


@pytest.mark.parametrize(
    ("failure", "category"),
    [
        (OperationalError("password=secret value='secret'"), "unavailable"),
        (ProgrammingError("SELECT 'secret'"), "internal"),
        (ProgrammingError("secret", name="NOT_ENOUGH_PRIVILEGES"), "forbidden"),
    ],
)
def test_driver_error_is_redacted(failure: Exception, category: str) -> None:
    with pytest.raises(CompiledQueryError) as exc:
        ClickHouseExecutor(SyncClient(failure)).execute(compiled())
    assert exc.value.category == category
    assert "secret" not in str(exc.value)
    assert "SELECT" not in str(exc.value)


def test_connection_repr_redacts_password() -> None:
    marker = "private-token"
    connection = ClickHouseConnection(password=marker)
    assert marker not in repr(connection)


def test_executors_close_owned_driver_clients() -> None:
    class ClosableSyncClient(SyncClient):
        closed = False

        def close(self) -> None:
            self.closed = True

    class ClosableAsyncClient(AsyncClient):
        closed = False

        async def close(self) -> None:
            self.closed = True

    class ClosableControl:
        closed = False

        async def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
            return "finished"

        async def close(self) -> None:
            self.closed = True

    sync_client = ClosableSyncClient(Result((), []))
    async_client = ClosableAsyncClient(Result((), []))
    control_client = ClosableControl()
    ClickHouseExecutor(sync_client).close()
    asyncio.run(AsyncClickHouseExecutor(async_client, control_client).aclose())
    assert sync_client.closed
    assert async_client.closed
    assert control_client.closed


# system.settings for the connected user, as clickhouse-connect stores it.
def _server_settings(level: int) -> dict[str, SettingDef]:
    return {
        "readonly": SettingDef("readonly", str(level), 1 if level else 0),
    }


class ReadonlyUserClient(SyncClient):
    def __init__(self, level: int) -> None:
        super().__init__(Result(("value",), [(1,)]))
        self.server_settings = _server_settings(level)


def _sent_settings(client: SyncClient) -> dict[str, object]:
    args = cast(tuple[object, ...], client.calls[-1][0])
    return cast(dict[str, object], args[2])


@pytest.mark.parametrize("client", [ReadonlyUserClient(0), SyncClient(Result(("value",), [(1,)]))])
def test_default_sends_every_planner_setting(client: SyncClient) -> None:
    ClickHouseExecutor(cast(Any, client)).execute(compiled())
    sent = _sent_settings(client)
    assert {key: sent[key] for key in DEFAULT_QUERY_SETTINGS.values} == dict(
        DEFAULT_QUERY_SETTINGS.values
    )
    assert "query_id" in sent


# A readonly = 2 user may not change readonly, so the planner's readonly = 1
# made every query fail; a user already read-only needs no readonly setting.
@pytest.mark.parametrize("level", [1, 2])
def test_default_omits_readonly_for_a_user_already_read_only(level: int) -> None:
    client = ReadonlyUserClient(level)
    ClickHouseExecutor(cast(Any, client)).execute(compiled())
    sent = _sent_settings(client)
    assert "readonly" not in sent
    assert {key: sent[key] for key in DEFAULT_QUERY_SETTINGS.values if key != "readonly"} == {
        key: value for key, value in DEFAULT_QUERY_SETTINGS.values.items() if key != "readonly"
    }


@pytest.mark.parametrize("level", [1, 2])
def test_profile_policy_omits_only_readonly(level: int) -> None:
    client = ReadonlyUserClient(level)
    ClickHouseExecutor(cast(Any, client), readonly_policy="profile").execute(compiled())
    sent = _sent_settings(client)
    assert "readonly" not in sent
    assert {key: sent[key] for key in DEFAULT_QUERY_SETTINGS.values if key != "readonly"} == {
        key: value for key, value in DEFAULT_QUERY_SETTINGS.values.items() if key != "readonly"
    }


def test_profile_policy_preserves_a_stricter_planner_limit() -> None:
    client = ReadonlyUserClient(2)
    stricter = replace(
        compiled(),
        settings=QuerySettings({**DEFAULT_QUERY_SETTINGS.values, "max_threads": 2}),
    )
    ClickHouseExecutor(cast(Any, client), readonly_policy="profile").execute(stricter)
    assert _sent_settings(client)["max_threads"] == 2


@pytest.mark.parametrize("client", [ReadonlyUserClient(0), SyncClient(Result(("value",), []))])
def test_profile_policy_requires_verified_readonly_user(client: SyncClient) -> None:
    with pytest.raises(CompiledQueryError) as exc:
        ClickHouseExecutor(cast(Any, client), readonly_policy="profile").execute(compiled())
    assert exc.value.category == "forbidden"
    assert client.calls == []


@pytest.mark.parametrize(
    "readonly",
    [
        ProgrammingError("Cannot modify 'readonly' setting in readonly mode.", name="READONLY"),
        ProgrammingError("Setting readonly is unknown or readonly"),
        ProgrammingError("Setting readonly is readonly"),
    ],
)
def test_readonly_error_guides_only_for_our_own_setting(readonly: Exception) -> None:
    with pytest.raises(CompiledQueryError) as exc:
        ClickHouseExecutor(SyncClient(readonly)).execute(compiled())
    assert exc.value.category == "forbidden"
    assert "readonly_policy='profile'" in exc.value.message

    limit = ProgrammingError(
        "Cannot modify 'max_threads' setting in readonly mode.", name="READONLY"
    )
    with pytest.raises(CompiledQueryError) as exc:
        ClickHouseExecutor(SyncClient(limit), readonly_policy="query").execute(compiled())
    assert exc.value.category == "internal"
    assert "max_threads" not in exc.value.message


@pytest.mark.parametrize(
    ("policy", "level", "sends_readonly"),
    [("query", 0, True), ("query", 2, False), ("profile", 2, False)],
)
def test_async_executor_uses_the_same_readonly_policy(
    policy: ReadonlyPolicy, level: int, sends_readonly: bool
) -> None:
    async_client = AsyncClient(Result(("value",), [(1,)]))
    async_client.server_settings = _server_settings(level)  # type: ignore[attr-defined]
    executor = AsyncClickHouseExecutor(
        cast(Any, async_client), cast(Any, object()), readonly_policy=policy
    )
    asyncio.run(executor.execute(compiled()))
    sent = _sent_settings(async_client)
    assert ("readonly" in sent) is sends_readonly
    assert sent["max_execution_time"] == 30


def test_worker_bridge_keeps_profile_policy() -> None:
    client = ReadonlyUserClient(2)
    executor = AsyncFromSyncClickHouseExecutor(
        cast(Any, client), cast(Any, object()), readonly_policy="profile"
    )
    asyncio.run(executor.execute(compiled()))
    assert "readonly" not in _sent_settings(client)
    executor.close()


def test_invalid_readonly_policy_is_rejected() -> None:
    with pytest.raises(ValueError, match="readonly_policy"):
        ClickHouseExecutor(SyncClient(Result((), [])), readonly_policy=cast(Any, "invalid"))
    with pytest.raises(ValueError, match="readonly_policy"):
        ClickHouseConnection(readonly_policy=cast(Any, "invalid"))


class _FactoryClient:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs
        self.closed = False

    def close(self) -> None:
        self.closed = True


class _AsyncFactoryClient(_FactoryClient):
    async def close(self) -> None:  # type: ignore[override]
        self.closed = True


CONNECTION = ClickHouseConnection(
    host="ch.internal",
    port=8443,
    database="analytics",
    username="reader",
    password="secret",  # noqa: S106 - a fake client never connects
    secure=True,
    readonly_policy="profile",
)
CONNECTION_KWARGS = {
    "host": "ch.internal",
    "port": 8443,
    "database": "analytics",
    "username": "reader",
    "password": "secret",
    "secure": True,
}


def test_sync_factory_opens_a_query_and_a_fast_control_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import clickhouse_connect

    created: list[_FactoryClient] = []

    def get_client(**kwargs: object) -> _FactoryClient:
        created.append(_FactoryClient(**kwargs))
        return created[-1]

    monkeypatch.setattr(clickhouse_connect, "get_client", get_client)
    from hypequery.execution import create_clickhouse_executor

    executor = create_clickhouse_executor(CONNECTION)

    assert [client.kwargs for client in created] == [
        CONNECTION_KWARGS,
        {**CONNECTION_KWARGS, "send_receive_timeout": 2},
    ]
    assert executor._readonly_policy == "profile"
    executor.close()
    assert all(client.closed for client in created)


def test_sync_factory_closes_the_first_client_when_the_second_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import clickhouse_connect

    created: list[_FactoryClient] = []

    def get_client(**kwargs: object) -> _FactoryClient:
        if created:
            raise OSError("refused: ch.internal:8443 secret")
        created.append(_FactoryClient(**kwargs))
        return created[-1]

    monkeypatch.setattr(clickhouse_connect, "get_client", get_client)
    from hypequery.execution import create_clickhouse_executor

    with pytest.raises(CompiledQueryError) as caught:
        create_clickhouse_executor(CONNECTION)

    assert caught.value.category == "unavailable"
    assert "secret" not in str(caught.value)
    assert created[0].closed


def test_async_factory_opens_a_query_and_a_fast_control_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import clickhouse_connect.driver as driver

    created: list[_AsyncFactoryClient] = []

    async def create_async_client(**kwargs: object) -> _AsyncFactoryClient:
        created.append(_AsyncFactoryClient(**kwargs))
        return created[-1]

    monkeypatch.setattr(driver, "create_async_client", create_async_client)
    from hypequery.execution import create_async_clickhouse_executor

    async def scenario() -> None:
        executor = await create_async_clickhouse_executor(CONNECTION)
        await executor.aclose()

    asyncio.run(scenario())

    assert [client.kwargs for client in created] == [
        CONNECTION_KWARGS,
        {**CONNECTION_KWARGS, "send_receive_timeout": 2},
    ]
    assert all(client.closed for client in created)


def test_async_factory_closes_the_first_client_when_the_second_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import clickhouse_connect.driver as driver

    created: list[_AsyncFactoryClient] = []

    async def create_async_client(**kwargs: object) -> _AsyncFactoryClient:
        if created:
            raise OSError("refused")
        created.append(_AsyncFactoryClient(**kwargs))
        return created[-1]

    monkeypatch.setattr(driver, "create_async_client", create_async_client)
    from hypequery.execution import create_async_clickhouse_executor

    with pytest.raises(CompiledQueryError) as caught:
        asyncio.run(create_async_clickhouse_executor(CONNECTION))

    assert caught.value.category == "unavailable"
    assert created[0].closed
