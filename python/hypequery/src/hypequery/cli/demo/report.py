"""Render the self-test's answers for a terminal."""

from __future__ import annotations

from decimal import Decimal

from .answers import DemoAnswers

_SUMMED_DAILY = "summing each day's distinct users"


def _count(value: int) -> str:
    return f"{value:,}"


def _money(value: Decimal) -> str:
    return f"${value:,.2f}"


def _growth(value: float | None) -> str:
    return "n/a" if value is None else f"{value:+.1%}"


def render_report(answers: DemoAnswers) -> str:
    """The self-test's answers, with each wrong read beside the right one."""

    a = answers
    lines = [
        f"hypequery demo: embedded ClickHouse (chDB), signed in as tenant {a.tenant}",
        "",
        "1. Orders on a ReplacingMergeTree, where every update is a new row version",
        f"   {'':38}{'orders':>8}{'revenue':>15}",
        f"   {'plain read, no FINAL':38}{_count(a.plain_orders):>8}"
        f"{_money(a.plain_revenue):>15}   <- counts every version",
        f"   {'hypequery, resolved_rows.replacing()':38}{_count(a.orders):>8}"
        f"{_money(a.revenue):>15}   FINAL, deleted rows dropped",
        "",
        "2. Distinct users, July to September",
        f"   {'count_distinct (uniqExact)':46}{_count(a.users_exact):>9}   exact",
        f"   {'approx_count_distinct (uniq)':46}{_count(a.users_approx):>9}"
        "   estimate, marked approximate",
        f"   {'merge(uniq) over AggregatingMergeTree days':46}{_count(a.users_merged):>9}"
        "   states merged across days",
        f"   {_SUMMED_DAILY:46}{_count(a.users_summed_daily):>9}   <- counts a user once per day",
        "",
        "3. Revenue by month: measure.shift and a growth formula",
        f"   {'month':10}{'revenue':>14}{'previous month':>17}{'growth':>9}",
        *(
            f"   {m.month:10}{_money(m.revenue):>14}{_money(m.previous):>17}{_growth(m.growth):>9}"
            for m in a.months
        ),
        "",
        "4. Daily revenue: measure.trailing over 7 days",
        f"   {'day':12}{'revenue':>12}{'trailing 7 days':>18}",
        *(f"   {t.day:12}{_money(t.revenue):>12}{_money(t.trailing_7d):>18}" for t in a.trailing),
        "",
        f"5. Tenancy: {a.tenant} sees {_count(a.orders)} orders. {a.other_tenant}'s "
        f"{_count(a.other_tenant_orders)} share the tables and are never read.",
        "",
        f"MCP: {a.tools} tools over {a.datasets} datasets are ready. Sections 1, 2 and 5 were "
        "asked through query_dataset,",
        "as an agent asks them; agents cannot query window and shift measures yet.",
        "Run `hypequery demo` to serve them over stdio, or `hypequery demo --print-config` "
        "for an MCP client config.",
    ]
    return "\n".join(lines)
