"""Own only a randomly named gate database; no externally supplied SQL."""

from __future__ import annotations

import json
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
                data.command(
                    "CREATE TABLE client_profiles (id UInt64, org_id String, label String, score Decimal(18,2)) ENGINE=Memory"
                )
                data.command(
                    "INSERT INTO client_profiles VALUES (1,'a','gold',9007199254740993.12),(2,'a','silver',7),(3,'b','private-other-tenant',999),(4,'b','gold',20),(5,'b','silver',30)"
                )
                data.command(
                    "ALTER TABLE client_orders UPDATE created_at = toDateTime('2026-01-01 01:00:00', 'UTC') WHERE org_id='a' AND id=1 SETTINGS mutations_sync=2"
                )
                data.command(
                    "ALTER TABLE client_orders UPDATE created_at = toDateTime('2026-01-02 01:00:00', 'UTC') WHERE org_id='a' AND id=2 SETTINGS mutations_sync=2"
                )
                queries = {
                    "related": "SELECT o.country AS country, p.label AS `profile.label`, toString(sum(o.amount)) AS revenue, toString(sumOrNull(p.score)) AS `profile.total`, toString(minOrNull(p.score)) AS `profile.minimum` FROM client_orders o LEFT JOIN client_profiles p ON o.id=p.id AND o.org_id=p.org_id WHERE o.org_id={tenant:String} GROUP BY o.country,p.label ORDER BY country ASC SETTINGS join_use_nulls=1",
                    "having": "SELECT country,toString(sum(amount)) AS revenue FROM client_orders WHERE org_id={tenant:String} GROUP BY country HAVING sum(amount)>=20 ORDER BY country ASC",
                    "time": "SELECT formatDateTime(toStartOfDay(created_at,'America/Los_Angeles'),'%Y-%m-%d %H:%i:%S','America/Los_Angeles') AS period,toString(sum(amount)) AS revenue FROM client_orders WHERE org_id={tenant:String} GROUP BY period ORDER BY period ASC",
                }
                oracle = {}
                for tenant in ("a", "b"):
                    oracle[tenant] = {}
                    for case, sql in queries.items():
                        result = data.query(sql, parameters={"tenant": tenant})
                        oracle[tenant][case] = [
                            dict(zip(result.column_names, row, strict=True))
                            for row in result.result_rows
                        ]
                Path(
                    os.environ["HYPEQUERY_GATE_OUTPUT"], "semantic-oracle.json"
                ).write_text(json.dumps(oracle))
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
