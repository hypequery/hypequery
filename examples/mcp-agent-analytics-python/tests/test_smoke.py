"""Smoke test against the seed: a scripted MCP client over stdio, as Claude Code or Cursor would connect."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import anyio
import pytest
from clickhouse_connect import get_client
from mcp import Client, StdioServerParameters

from agent import RANGE, ROOT, run_transcript
from analytics.connection import connection_from_env


def raw_count(tenant_id: int) -> int:
    """Ground truth straight from the driver, bypassing hypequery."""
    c = connection_from_env()
    ch = get_client(host=c.host, port=c.port, username=c.username, password=c.password, database=c.database)
    return int(
        ch.command(
            "SELECT count() FROM events WHERE tenant_id = {t:UInt32} AND occurred_at BETWEEN {a:String} AND {b:String}",
            parameters={"t": tenant_id, "a": RANGE[0], "b": RANGE[1]},
        )
    )


@pytest.fixture(scope="module")
def transcripts() -> dict[str, dict]:
    return {t: anyio.run(run_transcript, t) for t in ("153", "170")}


def test_exposes_four_tools_and_only_the_published_datasets(transcripts: dict[str, dict]) -> None:
    t = transcripts["153"]
    assert t["tools"] == ["get_dataset_schema", "list_datasets", "query_dataset", "query_metric"]
    assert [d["name"] for d in t["datasets"]["datasets"]] == ["events", "subscriptions"]
    assert "tenants" not in json.dumps(t["datasets"])
    measures = t["eventsSchema"]["endpoints"][0]["measures"]
    assert sorted(measures) == ["error_rate", "errors", "events", "p95_latency_ms", "unique_users"]


def test_scopes_every_query_to_the_launch_tenant(transcripts: dict[str, dict]) -> None:
    """The exampleRequest: `TENANT_ID=153 uv run agent.py --json`."""
    totals = {}
    for tenant, t in transcripts.items():
        rows = t["eventsByType"]["data"]
        assert len(rows) == 6
        assert set(rows[0]) == {"event_type", "events", "unique_users", "error_rate"}
        totals[tenant] = sum(int(r["events"]) for r in rows)
        assert totals[tenant] == raw_count(int(tenant))
    assert totals["153"] != totals["170"]


def test_refuses_a_prompt_injected_tenant_filter_and_never_returns_sql(transcripts: dict[str, dict]) -> None:
    t = transcripts["153"]
    assert t["tenantFilterRefused"] == {"ok": True, "code": "MCP_INVALID_ARGUMENTS"}
    assert "SELECT" not in json.dumps(transcripts).upper()


@pytest.mark.skipif(shutil.which("uv") is None, reason="the client configs launch uv")
@pytest.mark.parametrize("config", [".mcp.json", ".cursor/mcp.json"])
def test_the_checked_in_client_configs_start_the_server(config: str) -> None:
    entry = json.loads((ROOT / config).read_text())["mcpServers"]["hypequery-seed-analytics"]
    args = [a.replace("${workspaceFolder}", str(ROOT)) for a in entry["args"]]
    # CI may point CLICKHOUSE_* elsewhere; the config's own values otherwise.
    env = {**entry["env"], **os.environ, "TENANT_ID": entry["env"]["TENANT_ID"]}

    async def session() -> int:
        server = StdioServerParameters(command=entry["command"], args=args, cwd=str(Path(ROOT)), env=env)
        async with Client(server) as client:
            assert len((await client.list_tools()).tools) == 4
            result = await client.call_tool("query_dataset", {"dataset": "events", "measures": ["events"]})
            return int(result.structured_content["data"][0]["events"])

    assert anyio.run(session) > 0
