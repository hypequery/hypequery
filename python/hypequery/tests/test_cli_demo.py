"""`hypequery demo`: seeding, the self-test's answers against hand-written SQL, and MCP.

The demo opens an on-disk chDB database, and chDB holds one database path per
process, so everything that opens it runs in a subprocess.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from decimal import Decimal
from importlib.util import find_spec
from pathlib import Path
from typing import Any

import pytest

from hypequery.cli import main
from hypequery.cli.demo.answers import DemoAnswers, MonthRevenue, TrailingRevenue
from hypequery.cli.demo.api import DEFAULT_TENANT, TENANTS
from hypequery.cli.demo.database import seed_statements
from hypequery.cli.demo.report import render_report
from hypequery.cli.parser import parse_args

needs_chdb = pytest.mark.skipif(find_spec("chdb") is None, reason="chdb is not installed")

#: Ground truth, written without FINAL, merge combinators or hypequery: the
#: latest version of each order by argMax, distinct users by uniqExact and uniq.
LATEST_ORDERS = """
    CREATE VIEW latest_orders AS
    SELECT tenant_id, order_id, argMax(amount, version) AS amount,
           argMax(created_at, version) AS created_at, argMax(is_deleted, version) AS deleted
    FROM orders GROUP BY tenant_id, order_id
"""
GROUND_TRUTH = {
    "resolved": "SELECT count(), sum(amount) FROM latest_orders "
    "WHERE tenant_id = {tenant:String} AND deleted = 0",
    "versions": "SELECT count(), sum(amount) FROM orders WHERE tenant_id = {tenant:String}",
    "other_tenant": "SELECT count() FROM latest_orders "
    "WHERE tenant_id = {other:String} AND deleted = 0",
    "users": "SELECT uniqExact(user_id), uniq(user_id) FROM events "
    "WHERE tenant_id = {tenant:String}",
    "summed_daily": "SELECT sum(users) FROM (SELECT uniqExact(user_id) AS users FROM events "
    "WHERE tenant_id = {tenant:String} GROUP BY toDate(event_time))",
    "monthly": "SELECT toString(toStartOfMonth(created_at)), sum(amount) FROM latest_orders "
    "WHERE tenant_id = {tenant:String} AND deleted = 0 GROUP BY 1 ORDER BY 1",
    "daily": "SELECT toString(toDate(created_at)), sum(amount) FROM latest_orders "
    "WHERE tenant_id = {tenant:String} AND deleted = 0 GROUP BY 1 ORDER BY 1",
}

#: Runs the self-test's queries and the ground truth on one seeded database.
SELF_TEST = """
import anyio, dataclasses, json, sys

from hypequery.cli.demo.answers import gather_answers
from hypequery.cli.demo.database import connect
from hypequery.cli.demo.session import agent_for, demo_session

tenant, other, setup, queries = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])
values = {"tenant": tenant, "other": other}


def rows(connection, sql):
    text = connection.query(sql, "TSV", params=values).bytes().decode().strip()
    return [line.split("\\t") for line in text.splitlines()]


async def run():
    async with demo_session(tenant) as session:
        connection = connect(session.path)
        try:
            answers = await gather_answers(
                tenant_id=tenant,
                other_tenant_id=other,
                agent=session.agent,
                other_agent=await agent_for(session.api, other),
                client=session.client,
                connection=connection,
            )
            parts = rows(connection, "SELECT count() FROM system.parts WHERE table = 'orders'")
            connection.query(setup)
            truth = {name: rows(connection, sql) for name, sql in queries.items()}
        finally:
            connection.close()
    output = {"answers": dataclasses.asdict(answers), "truth": truth, "parts": parts[0][0]}
    print(json.dumps(output, default=str))


anyio.run(run)
"""


def demo_environment() -> dict[str, str]:
    """A bare environment, with no network proxy or project settings to lean on."""

    import os

    coverage = {key: value for key, value in os.environ.items() if key.startswith("COVERAGE")}
    return {"PATH": "/usr/bin:/bin", "CI": "1", "HYPEQUERY_TELEMETRY_DISABLED": "1", **coverage}


def run_python(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
        env=demo_environment(),
        timeout=120,
    )


def self_test(tenant: str, other: str, cwd: Path) -> dict[str, Any]:
    queries = json.dumps(GROUND_TRUTH)
    result = run_python("-c", SELF_TEST, tenant, other, LATEST_ORDERS, queries, cwd=cwd)
    assert result.returncode == 0, result.stderr
    assert result.stdout.count("\n") == 1, "seeding must not write to stdout"
    output: dict[str, Any] = json.loads(result.stdout)
    return output


# Seeding


def test_the_seed_script_ships_as_package_data_and_splits_into_statements() -> None:
    statements = seed_statements()
    assert statements[0].startswith("CREATE TABLE orders")
    assert [s.split()[0] for s in statements] == [
        "CREATE",
        "SYSTEM",
        "INSERT",
        "INSERT",
        "INSERT",
        "CREATE",
        "CREATE",
        "CREATE",
        "INSERT",
    ]
    assert not any("--" in s or s.endswith(";") for s in statements)
    # Everything comes from numbers(): no file, URL or remote table function.
    assert not any(word in " ".join(statements) for word in ("url(", "s3(", "file(", "remote("))


@needs_chdb
@pytest.mark.parametrize(("tenant", "other"), [("acme", "globex"), ("globex", "acme")])
def test_the_self_test_answers_match_hand_written_sql(
    tenant: str, other: str, tmp_path: Path
) -> None:
    output = self_test(tenant, other, tmp_path)
    answers, truth = output["answers"], output["truth"]

    # Three inserts are three parts, kept apart: the plain read sees every version.
    assert output["parts"] == "3"
    [[versions, versions_revenue]] = truth["versions"]
    assert (answers["plain_orders"], answers["plain_revenue"]) == (int(versions), versions_revenue)
    [[resolved, revenue]] = truth["resolved"]
    assert (answers["orders"], answers["revenue"]) == (int(resolved), revenue)
    assert answers["plain_orders"] > answers["orders"] * 1.5
    assert answers["other_tenant_orders"] == int(truth["other_tenant"][0][0])

    [[exact, approximate]] = truth["users"]
    assert answers["users_exact"] == int(exact)
    assert answers["users_approx"] == int(approximate)
    # The merged daily uniq states give the same estimate as uniq over the raw events.
    assert answers["users_merged"] == int(approximate)
    assert answers["users_exact"] != answers["users_approx"]
    # Summing each day's distinct users counts a returning user once per day.
    assert answers["users_summed_daily"] == pytest.approx(int(truth["summed_daily"][0][0]), 0.01)
    assert answers["users_summed_daily"] > 1.4 * answers["users_exact"]

    monthly = {month[:7]: Decimal(value) for month, value in truth["monthly"]}
    assert [m["month"] for m in answers["months"]] == ["2026-08", "2026-09"]
    for month, previous in zip(answers["months"], ("2026-07", "2026-08"), strict=True):
        assert Decimal(month["revenue"]) == monthly[month["month"]]
        assert Decimal(month["previous"]) == monthly[previous]
        expected = (monthly[month["month"]] - monthly[previous]) / monthly[previous]
        assert month["growth"] == pytest.approx(float(expected))

    daily = {day: Decimal(value) for day, value in truth["daily"]}
    days = sorted(daily)
    assert [t["day"] for t in answers["trailing"]] == days[-3:]
    for row in answers["trailing"]:
        position = days.index(row["day"])
        assert Decimal(row["revenue"]) == daily[row["day"]]
        assert Decimal(row["trailing_7d"]) == sum(
            daily[d] for d in days[position - 6 : position + 1]
        )

    assert (answers["tools"], answers["datasets"]) == (4, 3)


# The command


def test_self_test_prints_the_overcount_beside_the_resolved_read(tmp_path: Path) -> None:
    if find_spec("chdb") is None:
        pytest.skip("chdb is not installed")
    result = run_python("-m", "hypequery", "demo", "--self-test", cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert "plain read, no FINAL                     2,864    $229,567.18" in result.stdout
    assert "hypequery, resolved_rows.replacing()     1,536    $122,017.49" in result.stdout
    assert "count_distinct (uniqExact)                      124,674" in result.stdout
    assert "MCP: 4 tools over 3 datasets are ready." in result.stdout
    # The database lived in a temporary directory, not the working directory.
    assert list(tmp_path.iterdir()) == []


def test_the_report_puts_each_wrong_read_beside_the_right_one() -> None:
    answers = DemoAnswers(
        tenant="acme",
        other_tenant="globex",
        plain_orders=2864,
        plain_revenue=Decimal("229567.18"),
        orders=1536,
        revenue=Decimal("122017.49"),
        other_tenant_orders=768,
        users_exact=124674,
        users_approx=124493,
        users_merged=124493,
        users_summed_daily=264042,
        months=(MonthRevenue("2026-08", Decimal("2"), Decimal("1"), 1.0),),
        trailing=(TrailingRevenue("2026-09-30", Decimal("1"), Decimal("7")),),
        tools=4,
        datasets=3,
    )
    report = render_report(answers)
    assert "<- counts every version" in report
    assert "<- counts a user once per day" in report
    assert "2026-08            $2.00            $1.00  +100.0%" in report
    assert "acme sees 1,536 orders. globex's 768 share the tables" in report


def test_print_config_launches_the_demo_through_uvx(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--no-telemetry", "demo", "--print-config"]) == 0
    captured = capsys.readouterr()
    assert json.loads(captured.out) == {
        "mcpServers": {
            "hypequery-demo": {
                "command": "uvx",
                "args": ["--from", "hypequery[chdb,mcp]", "hypequery", "demo"],
            }
        }
    }
    assert "claude mcp add hypequery-demo -- uvx --from 'hypequery[chdb,mcp]'" in captured.err

    main(["--no-telemetry", "demo", "--print-config", "--tenant", "globex"])
    config = json.loads(capsys.readouterr().out)
    assert config["mcpServers"]["hypequery-demo"]["args"][-2:] == ["--tenant", "globex"]


def test_missing_extras_are_reported_actionably(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from hypequery.cli.commands import demo

    monkeypatch.setattr(demo, "find_spec", lambda name: None)
    assert main(["--no-telemetry", "demo", "--self-test"]) == 1
    assert 'uvx --from "hypequery[chdb,mcp]" hypequery demo' in capsys.readouterr().err

    monkeypatch.setattr(demo, "find_spec", lambda name: None if name == "mcp" else object())
    assert main(["--no-telemetry", "demo"]) == 1
    error = capsys.readouterr().err
    assert 'pip install "hypequery[mcp]"' in error
    assert "hypequery demo --self-test" in error


def test_the_tenant_choices_are_the_seeded_tenants() -> None:
    assert parse_args(["demo"]).tenant == DEFAULT_TENANT
    for tenant in TENANTS:
        assert parse_args(["demo", "--tenant", tenant]).tenant == tenant
    with pytest.raises(SystemExit):
        parse_args(["demo", "--tenant", "initech"])
    with pytest.raises(SystemExit):
        parse_args(["demo", "--self-test", "--print-config"])


# MCP


@needs_chdb
def test_an_agent_lists_the_tools_and_queries_over_stdio(tmp_path: Path) -> None:
    mcp = pytest.importorskip("mcp")

    async def session() -> None:
        parameters = mcp.StdioServerParameters(
            command=sys.executable,
            args=["-m", "hypequery", "demo"],
            env=demo_environment(),
            cwd=str(tmp_path),
        )
        async with mcp.Client(parameters) as client:
            tools = await client.list_tools()
            assert [tool.name for tool in tools.tools] == [
                "list_datasets",
                "get_dataset_schema",
                "query_metric",
                "query_dataset",
            ]
            listed = await client.call_tool("list_datasets", {})
            assert listed.structured_content is not None
            assert [d["name"] for d in listed.structured_content["datasets"]] == [
                "daily_activity",
                "events",
                "orders",
            ]
            result = await client.call_tool(
                "query_dataset", {"dataset": "orders", "measures": ["orders", "revenue"]}
            )
            assert not result.is_error, result
            assert result.structured_content == {
                "data": [{"orders": "1536", "revenue": "122017.49"}]
            }
            # The tenant comes from the credential: a caller cannot filter its way out.
            escape = await client.call_tool(
                "query_dataset",
                {
                    "dataset": "orders",
                    "measures": ["orders"],
                    "filters": [{"field": "tenant_id", "operator": "eq", "value": "globex"}],
                },
            )
            assert escape.is_error

    asyncio.run(session())
    assert list(tmp_path.iterdir()) == []
