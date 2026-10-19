"""A deliberately narrow test double for browser wiring; never a supported backend."""

import sqlite3
from dataclasses import dataclass
from threading import Lock

from hypequery.datasets.planner import CompiledQuery


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[object, ...], ...]


class BrowserFixtureExecutor:
    def __init__(self):
        self.connection = sqlite3.connect(":memory:", check_same_thread=False)
        self.lock = Lock()
        self.connection.execute(
            "CREATE TABLE orders (id INTEGER, country TEXT, amount INTEGER, org_id TEXT)"
        )
        self.connection.executemany(
            "INSERT INTO orders VALUES (?, ?, ?, ?)",
            [
                (1, "UK", 10, "a"),
                (2, "US", 20, "a"),
                (3, None, 30, "a"),
                (4, "UK", 900, "b"),
                (5, "CA", 100, "b"),
            ],
        )

    def execute(self, compiled: CompiledQuery) -> Rows:
        # Only placeholder syntax differs for this small query subset. Values
        # remain bound, and the SDK still owns all SQL and tenant scoping.
        sql = compiled.sql
        for parameter in compiled.parameters.values():
            sql = sql.replace(parameter.placeholder, ":" + parameter.name)
        with self.lock:
            cursor = self.connection.execute(sql, compiled.parameter_values())
            return Rows(
                tuple(column[0] for column in cursor.description),
                tuple(cursor.fetchall()),
            )

    def close(self):
        with self.lock:
            self.connection.close()
