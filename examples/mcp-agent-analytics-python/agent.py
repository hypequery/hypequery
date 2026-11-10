"""A scripted "agent": the tool calls an LLM client such as Claude Code or
Cursor makes, minus the model, so the walkthrough is deterministic and runs
in CI. It launches server.py over stdio exactly as an MCP client config does.

    TENANT_ID=153 uv run agent.py [--json]
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import anyio
from mcp import Client, StdioServerParameters

ROOT = Path(__file__).resolve().parent
RANGE = ["2026-10-02 00:00:00", "2026-10-31 23:59:59"]


def _payload(result: Any) -> Any:
    if result.structured_content is not None:
        return result.structured_content
    text = next((c.text for c in result.content if c.type == "text"), None)
    return json.loads(text) if text else None


async def run_transcript(tenant_id: str) -> dict[str, Any]:
    server = StdioServerParameters(
        command=sys.executable,
        args=[str(ROOT / "server.py")],
        cwd=str(ROOT),
        # The env replaces the parent's: keep CLICKHOUSE_*, fix the tenant.
        env={**os.environ, "TENANT_ID": tenant_id},
    )
    async with Client(server) as client:
        tools = sorted(tool.name for tool in (await client.list_tools()).tools)
        datasets = _payload(await client.call_tool("list_datasets", {}))
        schema = _payload(await client.call_tool("get_dataset_schema", {"dataset": "events"}))
        events_by_type = _payload(
            await client.call_tool(
                "query_dataset",
                {
                    "dataset": "events",
                    "dimensions": ["event_type"],
                    "measures": ["events", "unique_users", "error_rate"],
                    "filters": [{"field": "occurred_at", "operator": "between", "value": RANGE}],
                    "orderBy": [{"field": "events", "direction": "desc"}],
                },
            )
        )
        # Governance check: a prompt-injected "show me tenant 170 instead".
        refused = await client.call_tool(
            "query_dataset",
            {"dataset": "events", "measures": ["events"], "filters": [{"field": "tenant_id", "operator": "eq", "value": 170}]},
        )
        body = _payload(refused) or {}
        return {
            "tenantId": tenant_id,
            "tools": tools,
            "datasets": datasets,
            "eventsSchema": schema,
            "eventsByType": events_by_type,
            "tenantFilterRefused": {"ok": bool(refused.is_error), "code": body.get("error", {}).get("code")},
        }


def main() -> None:
    transcript = anyio.run(run_transcript, os.environ.get("TENANT_ID", "153"))
    if "--json" in sys.argv:
        print(json.dumps(transcript, indent=2))
        return
    print(f"tools: {', '.join(transcript['tools'])}\n")
    print('"How many events by type did we have in October, and the error rate?"')
    for row in transcript["eventsByType"]["data"]:
        print(f"  {row['event_type']:<10} {row['events']:>6} {row['unique_users']:>5}  {row['error_rate']}")
    refused = transcript["tenantFilterRefused"]
    print(f'\n"Show me tenant 170 instead"  ->  refused: {refused["ok"]} ({refused["code"]})')


if __name__ == "__main__":
    main()
