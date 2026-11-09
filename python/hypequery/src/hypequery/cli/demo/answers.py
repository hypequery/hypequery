"""The questions `hypequery demo --self-test` asks, and the answers it gets.

Every question an MCP tool can answer goes through `query_dataset`, exactly as
an agent's call does. Window and shift measures need a bounded time range that
client contracts do not advertise yet, so those go through the Python dataset
client. The plain reads are what a query that ignores the table engines gets,
run directly on the same database for comparison.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal
from typing import cast

from hypequery.datasets import AsyncDatasetClient, DatasetQuery, order, tenant
from hypequery.datasets import filter as f
from hypequery.mcp import ClientContractExecutor

from ..errors import CliError
from .database import SqlConnection
from .model import orders

#: The seeded data covers July to September 2026.
PERIOD_START = "2026-07-01T00:00:00Z"
PERIOD_END = "2026-10-01T00:00:00Z"
#: Month-over-month growth for the last two months; July is the first comparison point.
GROWTH_START = "2026-08-01T00:00:00Z"
#: The last three days of the period, each with its trailing seven days.
TRAILING_START = "2026-09-28T00:00:00Z"

#: Every order version, as a read without FINAL sees them.
PLAIN_ORDERS_SQL = (
    "SELECT count(), sum(amount) FROM orders WHERE tenant_id = {tenant:String} FORMAT TSV"
)
#: Each day's distinct users, summed: a pre-aggregate rolled up as if it were additive.
SUMMED_DAILY_USERS_SQL = (
    "SELECT sum(users) FROM (SELECT uniqMerge(users_state) AS users FROM daily_activity "
    "WHERE tenant_id = {tenant:String} GROUP BY day) FORMAT TSV"
)


@dataclass(frozen=True, slots=True)
class MonthRevenue:
    month: str
    revenue: Decimal
    previous: Decimal
    growth: float | None


@dataclass(frozen=True, slots=True)
class TrailingRevenue:
    day: str
    revenue: Decimal
    trailing_7d: Decimal


@dataclass(frozen=True, slots=True)
class DemoAnswers:
    tenant: str
    other_tenant: str
    plain_orders: int
    plain_revenue: Decimal
    orders: int
    revenue: Decimal
    other_tenant_orders: int
    users_exact: int
    users_approx: int
    users_merged: int
    users_summed_daily: int
    months: tuple[MonthRevenue, ...]
    trailing: tuple[TrailingRevenue, ...]
    tools: int
    datasets: int


async def query_tool(
    executor: ClientContractExecutor, arguments: Mapping[str, object]
) -> dict[str, object]:
    """The one row `query_dataset` returns for *arguments*."""

    result = await executor.call_tool("query_dataset", arguments)
    content = cast(Mapping[str, object], result.get("structuredContent", {}))
    rows = content.get("data")
    if result.get("isError") or not isinstance(rows, list) or len(rows) != 1:
        raise CliError(f"The demo query on {arguments['dataset']} failed: {content}")
    return cast(dict[str, object], rows[0])


def _plain_read(connection: SqlConnection, sql: str, tenant_id: str) -> list[str]:
    result = connection.query(sql, "TSV", params={"tenant": tenant_id})
    return result.bytes().decode().strip().split("\t")


async def gather_answers(
    *,
    tenant_id: str,
    other_tenant_id: str,
    agent: ClientContractExecutor,
    other_agent: ClientContractExecutor,
    client: AsyncDatasetClient,
    connection: SqlConnection,
) -> DemoAnswers:
    """Ask every demo question as *tenant_id*; *other_agent* is signed in as *other_tenant_id*."""

    resolved = await query_tool(agent, {"dataset": "orders", "measures": ["orders", "revenue"]})
    others = await query_tool(other_agent, {"dataset": "orders", "measures": ["orders"]})
    users = await query_tool(agent, {"dataset": "events", "measures": ["users", "users_approx"]})
    merged = await query_tool(agent, {"dataset": "daily_activity", "measures": ["users"]})
    plain_orders, plain_revenue = _plain_read(connection, PLAIN_ORDERS_SQL, tenant_id)
    (summed_daily,) = _plain_read(connection, SUMMED_DAILY_USERS_SQL, tenant_id)

    scoped = client.for_tenant(tenant(tenant_id))
    monthly = await scoped.execute(
        orders(),
        DatasetQuery(
            by="month",
            measures=("revenue", "revenue_prev_month", "revenue_mom_growth"),
            filters=(f.gte("created_at", GROWTH_START), f.lt("created_at", PERIOD_END)),
            order_by=(order.asc("period"),),
        ),
    )
    daily = await scoped.execute(
        orders(),
        DatasetQuery(
            by="day",
            measures=("revenue", "revenue_7d"),
            filters=(
                f.gte("created_at", TRAILING_START),
                f.lt("created_at", PERIOD_END),
            ),
            order_by=(order.asc("period"),),
        ),
    )
    tools = await agent.list_tools()
    return DemoAnswers(
        tenant=tenant_id,
        other_tenant=other_tenant_id,
        plain_orders=int(plain_orders),
        plain_revenue=Decimal(plain_revenue),
        orders=int(str(resolved["orders"])),
        revenue=Decimal(str(resolved["revenue"])),
        other_tenant_orders=int(str(others["orders"])),
        users_exact=int(str(users["users"])),
        users_approx=int(str(users["users_approx"])),
        users_merged=int(str(merged["users"])),
        users_summed_daily=int(summed_daily),
        months=tuple(
            MonthRevenue(
                month=str(row["period"])[:7],
                revenue=Decimal(str(row["revenue"])),
                previous=Decimal(str(row["revenue_prev_month"])),
                growth=None
                if row["revenue_mom_growth"] is None
                else float(str(row["revenue_mom_growth"])),
            )
            for row in monthly.data
        ),
        trailing=tuple(
            TrailingRevenue(
                day=str(row["period"])[:10],
                revenue=Decimal(str(row["revenue"])),
                trailing_7d=Decimal(str(row["revenue_7d"])),
            )
            for row in daily.data
        ),
        tools=len(cast(list[object], tools["tools"])),
        datasets=len(agent.contract["endpoints"]),
    )
