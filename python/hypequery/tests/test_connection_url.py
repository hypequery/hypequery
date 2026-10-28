"""ClickHouseConnection.from_url, CLICKHOUSE_URL, and engine URLs."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

import pytest

from hypequery.contrib.sqlalchemy import connection_from_engine, executor_from_engine
from hypequery.execution import ClickHouseConnection, ClickHouseExecutor

SECRET = "s3cr3t-pw"  # noqa: S105 - a test credential


@pytest.mark.parametrize(
    ("url", "host", "port", "database", "secure"),
    [
        ("clickhouse://ch", "ch", None, "default", False),
        ("clickhouses://ch", "ch", None, "default", True),
        ("http://ch:8123/analytics", "ch", 8123, "analytics", False),
        ("https://ch:8443/analytics/", "ch", 8443, "analytics", True),
        ("clickhousedb://ch:18123/hq", "ch", 18123, "hq", False),
        ("clickhousedb://ch/hq?secure=true", "ch", None, "hq", True),
        ("clickhousedb+connect://ch/hq?protocol=https", "ch", None, "hq", True),
        ("clickhouse+http://ch:8123/hq", "ch", 8123, "hq", False),
        ("clickhouse+http://ch/hq?protocol=https", "ch", None, "hq", True),
        ("CLICKHOUSES://CH.internal", "ch.internal", None, "default", True),
        ("clickhouse://[::1]:8123", "::1", 8123, "default", False),
    ],
)
def test_url_forms(url: str, host: str, port: int | None, database: str, secure: bool) -> None:
    connection = ClickHouseConnection.from_url(url)
    assert (connection.host, connection.port, connection.database, connection.secure) == (
        host,
        port,
        database,
        secure,
    )
    assert (connection.username, connection.password) == ("default", "")


def test_credentials_are_percent_decoded_and_options_pass_through() -> None:
    connection = ClickHouseConnection.from_url(
        "clickhouse://read%40er:p%3Aw%2Fd@ch/db%20one",
        readonly_policy="profile",
        control_username="killer",
        control_password="kpw",  # noqa: S106 - a test credential
    )
    assert (connection.username, connection.password, connection.database) == (
        "read@er",
        "p:w/d",
        "db one",
    )
    assert connection.readonly_policy == "profile"
    assert (connection.control_username, connection.control_password) == ("killer", "kpw")
    assert "p:w/d" not in repr(connection)


@pytest.mark.parametrize(
    ("url", "message"),
    [
        (f"clickhouse+native://u:{SECRET}@ch:9000/db", "native protocol"),
        (f"clickhouse+asynch://u:{SECRET}@ch:9000/db", "native protocol"),
        (f"ftp://u:{SECRET}@ch/db", "unsupported ClickHouse URL scheme 'ftp'"),
        (f"clickhouse://u:{SECRET}@ch:99999/db", "port"),
        (f"clickhouse://u:{SECRET}@ch:http/db", "port"),
        (f"clickhouse://u:{SECRET}@ch/db?compress=1", "compress"),
        (f"clickhouse://u:{SECRET}@ch/db?secure=maybe", "secure parameter"),
        (f"clickhouse://u:{SECRET}@ch/db?protocol=tcp", "protocol parameter"),
        (f"clickhouses://u:{SECRET}@ch/db?secure=false", "conflicts"),
        (f"http://u:{SECRET}@ch/db?protocol=https", "conflicts"),
        (f"clickhouse://u:{SECRET}@ch/a/b", "single database"),
        (f"clickhouse://u:{SECRET}@ch/db#frag", "fragment"),
        (f"clickhouse://u:{SECRET}@ch/db?x", "malformed"),
        ("ch.internal:8123", "scheme and a host"),
        ("", "scheme and a host"),
    ],
)
def test_bad_urls_never_echo_the_password(url: str, message: str) -> None:
    with pytest.raises(ValueError, match=message) as caught:
        ClickHouseConnection.from_url(url)
    assert SECRET not in str(caught.value)


def test_a_url_must_be_a_string() -> None:
    with pytest.raises(TypeError, match="string"):
        ClickHouseConnection.from_url(b"clickhouse://ch")  # type: ignore[arg-type]


def test_env_url_replaces_the_field_variables() -> None:
    connection = ClickHouseConnection.from_env(
        {
            "CLICKHOUSE_URL": "clickhouses://reader:pw@ch.internal/analytics",
            "CLICKHOUSE_CONTROL_USERNAME": "killer",
        },
        readonly_policy="profile",
    )
    assert connection == ClickHouseConnection(
        host="ch.internal",
        database="analytics",
        username="reader",
        password="pw",  # noqa: S106 - a test credential
        secure=True,
        readonly_policy="profile",
        control_username="killer",
    )


def test_an_empty_env_url_is_unset() -> None:
    assert ClickHouseConnection.from_env({"CLICKHOUSE_URL": " "}).host == "localhost"


@pytest.mark.parametrize(
    "name",
    [
        "CLICKHOUSE_HOST",
        "CLICKHOUSE_PORT",
        "CLICKHOUSE_DATABASE",
        "CLICKHOUSE_USERNAME",
        "CLICKHOUSE_PASSWORD",
        "CLICKHOUSE_SECURE",
    ],
)
def test_env_url_and_field_variables_conflict(name: str) -> None:
    with pytest.raises(ValueError, match=f"cannot be combined with {name}"):
        ClickHouseConnection.from_env({"CLICKHOUSE_URL": "clickhouse://ch", name: "1"})


def test_a_bad_env_url_names_the_variable_without_echoing_it() -> None:
    with pytest.raises(ValueError, match="CLICKHOUSE_URL is invalid") as caught:
        ClickHouseConnection.from_env({"CLICKHOUSE_URL": f"clickhouse://u:{SECRET}@ch:0"})
    assert SECRET not in str(caught.value)


@dataclass
class _URL:
    drivername: str
    host: str | None = "ch"
    port: int | None = 8123
    username: str | None = "reader"
    password: str | None = "pw"  # noqa: S105 - a test credential
    database: str | None = "hq"
    query: Mapping[str, str | tuple[str, ...]] = field(default_factory=dict)


@dataclass
class _Engine:
    url: _URL


def test_engine_urls_are_read_without_rendering_them() -> None:
    connection = connection_from_engine(
        _Engine(_URL("clickhousedb", query={"secure": "true", "compress": ("lz4", "zstd")}))
    )
    assert (connection.host, connection.port, connection.database) == ("ch", 8123, "hq")
    assert (connection.username, connection.password, connection.secure) == ("reader", "pw", True)
    # A URL object works as well as an engine, and dialect options are ignored.
    assert connection_from_engine(_URL("clickhouse+http", query={"compress": "1"})).secure is False


def test_engine_url_refusals() -> None:
    with pytest.raises(ValueError, match="native protocol"):
        connection_from_engine(_Engine(_URL("clickhouse+native")))
    with pytest.raises(ValueError, match="repeats the secure parameter"):
        connection_from_engine(_URL("clickhousedb", query={"secure": ("true", "false")}))


def test_real_sqlalchemy_urls() -> None:
    sqlalchemy = pytest.importorskip("sqlalchemy")
    url = sqlalchemy.engine.make_url("clickhousedb://reader:p%40w@ch:8443/hq?protocol=https")
    connection = connection_from_engine(url, readonly_policy="profile")
    assert (connection.password, connection.secure, connection.readonly_policy) == (
        "p@w",
        True,
        "profile",
    )


def test_executor_from_engine_opens_its_own_clients(monkeypatch: pytest.MonkeyPatch) -> None:
    import clickhouse_connect

    created: list[dict[str, object]] = []

    class _Client:
        def close(self) -> None:
            pass

    def get_client(**kwargs: object) -> _Client:
        created.append(kwargs)
        return _Client()

    monkeypatch.setattr(clickhouse_connect, "get_client", get_client)
    executor = executor_from_engine(_Engine(_URL("clickhousedb")), control_username="killer")
    assert isinstance(executor, ClickHouseExecutor)
    assert [(kwargs["host"], kwargs["username"]) for kwargs in created] == [
        ("ch", "reader"),
        ("ch", "killer"),
    ]
    executor.close()
