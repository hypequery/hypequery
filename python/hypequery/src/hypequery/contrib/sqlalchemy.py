"""Point hypequery at the ClickHouse server a SQLAlchemy engine already uses.

This reads the engine's URL and opens hypequery's own driver clients; it never
borrows a pooled connection. Borrowing would pin one pool slot for the life of
the process, closing the executor would close SQLAlchemy's client, and there
would be no separate control connection to cancel queries with. A
clickhouse-connect HTTP client is cheap, so two of them cost little.

SQLAlchemy itself is never imported: anything with an engine's ``url`` works.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol, cast

from ..execution import (
    ClickHouseConnection,
    ClickHouseExecutor,
    ReadonlyPolicy,
    create_clickhouse_executor,
)
from ..execution.utils.connection_url import url_parts_fields


class SQLAlchemyURL(Protocol):
    """The parts of ``sqlalchemy.engine.URL`` this module reads."""

    @property
    def drivername(self) -> str: ...
    @property
    def host(self) -> str | None: ...
    @property
    def port(self) -> int | None: ...
    @property
    def username(self) -> str | None: ...
    @property
    def password(self) -> str | None: ...
    @property
    def database(self) -> str | None: ...
    @property
    def query(self) -> Mapping[str, str | tuple[str, ...]]: ...


class SQLAlchemyEngine(Protocol):
    @property
    def url(self) -> SQLAlchemyURL: ...


def _single_values(query: Mapping[str, str | tuple[str, ...]]) -> dict[str, str]:
    """Single-valued parameters. A repeated one is only an error if it is read."""

    values: dict[str, str] = {}
    for name, value in query.items():
        if isinstance(value, str):
            values[name] = value
        elif name in ("secure", "protocol"):
            raise ValueError(f"the engine URL repeats the {name} parameter")
    return values


def connection_from_engine(
    engine: SQLAlchemyEngine | SQLAlchemyURL,
    *,
    readonly_policy: ReadonlyPolicy = "query",
    control_username: str | None = None,
    control_password: str = "",
) -> ClickHouseConnection:
    """The :class:`ClickHouseConnection` for *engine*'s (or a URL's) server.

    The engine must use an HTTP-interface dialect: ``clickhousedb://``
    (clickhouse-connect) or ``clickhouse+http://`` (clickhouse-sqlalchemy).
    ``clickhouse+native://`` is refused with an explanation. Of the URL's
    query parameters only ``secure`` and ``protocol`` are read; the rest are
    the dialect's own options.
    """

    url = cast(SQLAlchemyURL, getattr(engine, "url", engine))
    fields = url_parts_fields(
        scheme=url.drivername,
        host=url.host,
        port=url.port,
        username=url.username,
        password=url.password,
        database=url.database,
        query=_single_values(url.query),
        other_parameters="ignore",
    )
    return ClickHouseConnection(
        **fields,
        readonly_policy=readonly_policy,
        control_username=control_username,
        control_password=control_password,
    )


def executor_from_engine(
    engine: SQLAlchemyEngine | SQLAlchemyURL,
    *,
    readonly_policy: ReadonlyPolicy = "query",
    control_username: str | None = None,
    control_password: str = "",
) -> ClickHouseExecutor:
    """A sync executor for the server *engine* connects to, with its own clients.

    Close it independently of the engine (``executor.close()`` or a ``with``
    block); disposing the engine does not close it, and closing it does not
    touch the engine's pool.
    """

    return create_clickhouse_executor(
        connection_from_engine(
            engine,
            readonly_policy=readonly_policy,
            control_username=control_username,
            control_password=control_password,
        )
    )


__all__ = [
    "SQLAlchemyEngine",
    "SQLAlchemyURL",
    "connection_from_engine",
    "executor_from_engine",
]
