"""ClickHouseConnection.from_env: one parser for CLI, scaffolds and examples."""

from __future__ import annotations

import asyncio

import pytest

from hypequery.execution import (
    AsyncClickHouseExecutor,
    AsyncFromSyncClickHouseExecutor,
    ClickHouseConnection,
    ClickHouseExecutor,
)


def test_defaults_target_a_local_server() -> None:
    connection = ClickHouseConnection.from_env({})
    assert connection == ClickHouseConnection(
        host="localhost", port=None, database="default", username="default", password=""
    )


def test_every_variable_is_read() -> None:
    connection = ClickHouseConnection.from_env(
        {
            "CLICKHOUSE_HOST": "ch.internal",
            "CLICKHOUSE_PORT": "8443",
            "CLICKHOUSE_DATABASE": "analytics",
            "CLICKHOUSE_USERNAME": "reader",
            "CLICKHOUSE_PASSWORD": "pw",
            "CLICKHOUSE_SECURE": "TRUE",
        },
        readonly_policy="profile",
    )
    assert (connection.host, connection.port, connection.database) == (
        "ch.internal",
        8443,
        "analytics",
    )
    assert (connection.username, connection.password, connection.secure) == ("reader", "pw", True)
    assert connection.readonly_policy == "profile"


@pytest.mark.parametrize("value", ["", "0", "false", "No", "off"])
def test_falsey_secure_values(value: str) -> None:
    assert ClickHouseConnection.from_env({"CLICKHOUSE_SECURE": value}).secure is False


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("CLICKHOUSE_PORT", "http"),
        ("CLICKHOUSE_PORT", "0"),
        ("CLICKHOUSE_PORT", "65536"),
        ("CLICKHOUSE_PORT", "٨١٢٣"),
        ("CLICKHOUSE_SECURE", "sometimes"),
    ],
)
def test_malformed_values_name_the_variable_without_echoing_it(name: str, value: str) -> None:
    with pytest.raises(ValueError, match=name) as caught:
        ClickHouseConnection.from_env({name: value})
    assert value not in str(caught.value)


def test_the_process_environment_is_the_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLICKHOUSE_DATABASE", "from_process")
    assert ClickHouseConnection.from_env().database == "from_process"


def test_the_password_is_not_in_the_repr() -> None:
    connection = ClickHouseConnection.from_env({"CLICKHOUSE_PASSWORD": "hunter2"})
    assert "hunter2" not in repr(connection)


class _Closable:
    def __init__(self) -> None:
        self.closed = 0

    def query(self, *args: object, **kwargs: object) -> object:
        raise AssertionError("not called")

    def command(self, *args: object, **kwargs: object) -> object:
        raise AssertionError("not called")

    def close(self) -> None:
        self.closed += 1


class _AsyncClosable(_Closable):
    async def close(self) -> None:  # type: ignore[override]
        self.closed += 1


def test_sync_executor_closes_on_exit() -> None:
    client, control = _Closable(), _Closable()
    with ClickHouseExecutor(client, control_client=control) as executor:  # type: ignore[arg-type]
        assert isinstance(executor, ClickHouseExecutor)
    assert (client.closed, control.closed) == (1, 1)


def test_async_executors_close_on_exit() -> None:
    client, control = _AsyncClosable(), _AsyncClosable()
    bridge_client, bridge_control = _Closable(), _Closable()

    async def scenario() -> None:
        async with AsyncClickHouseExecutor(client, control):  # type: ignore[arg-type]
            pass
        async with AsyncFromSyncClickHouseExecutor(bridge_client, bridge_control):  # type: ignore[arg-type]
            pass

    asyncio.run(scenario())
    assert (client.closed, control.closed) == (1, 1)
    assert (bridge_client.closed, bridge_control.closed) == (1, 1)
