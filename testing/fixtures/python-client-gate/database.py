"""Own only a randomly named gate database; no externally supplied SQL."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import clickhouse_connect
from hypequery.execution import ClickHouseConnection

connection = ClickHouseConnection.from_env()
name = connection.database
if not re.fullmatch(r"hq_client_gate_[0-9a-f]{16}", name):
    raise ValueError("Expected the gate's owned database name")
client = clickhouse_connect.get_client(
    host=connection.host,
    port=connection.port,
    database="default",
    username=connection.username,
    password=connection.password,
    secure=connection.secure,
    autogenerate_session_id=False,
)
try:
    if sys.argv[1] == "cleanup":
        client.command(f"DROP DATABASE IF EXISTS {name}")
    elif sys.argv[1] == "prepare":
        client.command(f"CREATE DATABASE {name}")
        try:
            data = clickhouse_connect.get_client(
                host=connection.host,
                port=connection.port,
                database=name,
                username=connection.username,
                password=connection.password,
                secure=connection.secure,
                autogenerate_session_id=False,
            )
            try:
                for statement in (
                    Path("examples/client_dashboard/seed.sql").read_text().split(";")
                ):
                    if statement.strip():
                        data.command(statement)
                data.command(
                    "CREATE VIEW client_slow AS SELECT 'a' AS org_id, sleep(3) AS pause"
                )
                Path(os.environ["HYPEQUERY_GATE_VERSION_FILE"]).write_text(
                    data.query("SELECT version()").result_rows[0][0]
                )
            finally:
                data.close()
        except BaseException:
            client.command(f"DROP DATABASE {name}")
            raise
    else:
        raise ValueError("Expected prepare or cleanup")
finally:
    client.close()
