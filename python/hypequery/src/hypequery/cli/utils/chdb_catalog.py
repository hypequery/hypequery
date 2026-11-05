"""Schema discovery's catalog client, on an embedded chDB database.

Discovery asks its catalog queries through the clickhouse-connect calling
convention (``query(sql, parameters=..., settings=...).result_rows``). This
answers the same calls from chDB, binding values and settings as the chDB
executor does, so ``read_schema`` and ``discover_catalog`` run unchanged.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Protocol

from hypequery.execution.utils.json_compact import (
    JSON_COMPACT_SETTINGS,
    JsonCompactResult,
    decode_json_compact,
)
from hypequery.execution.utils.parameter_text import parameter_text
from hypequery.execution.utils.settings_clause import settings_clause

from ..errors import CliError


class _Result(Protocol):
    def bytes(self) -> bytes: ...


class _Connection(Protocol):
    def query(
        self, sql: str, fmt: str = ..., *, params: dict[str, str] | None = ...
    ) -> _Result: ...
    def close(self) -> None: ...


class ChdbCatalogClient:
    def __init__(self, connection: _Connection) -> None:
        self._connection = connection

    def query(
        self, query: str, *, parameters: dict[str, object], settings: dict[str, int]
    ) -> JsonCompactResult:
        sql = query + settings_clause(settings, JSON_COMPACT_SETTINGS)
        params = {name: parameter_text(value) for name, value in parameters.items()}
        result = self._connection.query(sql, "JSONCompact", params=params)
        return decode_json_compact(result.bytes(), "")

    def close(self) -> None:
        self._connection.close()


@contextmanager
def chdb_catalog(path: Path) -> Iterator[ChdbCatalogClient]:
    """A catalog client on the chDB database at *path*, which must already exist.

    Discovery never creates a database: chDB would make an empty directory
    at a mistyped path.
    """

    try:
        import chdb
    except ModuleNotFoundError as exc:
        raise CliError('Reading a chDB database requires: pip install "hypequery[chdb]"') from exc
    if not path.is_dir():
        raise CliError(f"There is no chDB database at {path}.")
    try:
        connection: _Connection = chdb.connect(str(path))
    except Exception as exc:
        # chDB locks an on-disk database to one process.
        raise CliError(
            f"Cannot open the chDB database at {path}. Only one process can use it at a "
            "time: stop anything else using it, such as hypequery dev, and try again."
        ) from exc
    client = ChdbCatalogClient(connection)
    try:
        yield client
    except CliError:
        raise
    except Exception as exc:
        raise CliError(f"Cannot inspect the chDB database at {path}.") from exc
    finally:
        client.close()
