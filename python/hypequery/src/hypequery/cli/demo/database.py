"""Create and seed the demo's embedded chDB database from the packaged `seed.sql`."""

from __future__ import annotations

import re
from importlib.resources import files
from pathlib import Path
from typing import Protocol

from ..errors import CliError

#: A statement ends with a semicolon at the end of a line.
_STATEMENT_END = re.compile(r";[ \t]*$", re.MULTILINE)


class QueryResult(Protocol):
    def bytes(self) -> bytes: ...


class SqlConnection(Protocol):
    """``chdb.connect()``'s connection."""

    def query(
        self, sql: str, fmt: str = ..., *, params: dict[str, str] | None = ...
    ) -> QueryResult: ...

    def close(self) -> None: ...


def seed_statements() -> tuple[str, ...]:
    """The packaged seed script's statements, without comments, in order."""

    script = files(__package__).joinpath("seed.sql").read_text(encoding="utf-8")
    statements = []
    for chunk in _STATEMENT_END.split(script):
        lines = [line for line in chunk.splitlines() if not line.lstrip().startswith("--")]
        statement = "\n".join(lines).strip()
        if statement:
            statements.append(statement)
    return tuple(statements)


def connect(path: Path) -> SqlConnection:
    """A chDB connection to the database at *path*, created if it does not exist."""

    try:
        import chdb
    except ModuleNotFoundError as exc:
        raise CliError(
            'The demo runs on embedded ClickHouse. Install: pip install "hypequery[chdb]"'
        ) from exc
    connection: SqlConnection = chdb.connect(str(path))
    return connection


def seed_database(path: Path) -> None:
    """Create the demo tables at *path* and load the sample data. Needs no network."""

    connection = connect(path)
    try:
        for statement in seed_statements():
            connection.query(statement)
    finally:
        connection.close()
