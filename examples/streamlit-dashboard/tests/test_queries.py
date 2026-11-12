"""The dataset layer on its own: DataFrames from hypequery equal raw SQL."""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from analytics import queries as q

OCTOBER = q.Filters(date(2026, 10, 1), date(2026, 10, 31))


def test_timeseries_is_a_typed_dataframe_that_sums_to_the_raw_count(raw) -> None:
    frame = q.timeseries(OCTOBER, "day")
    assert list(frame.columns) == ["period", "events", "active_users", "error_rate"]
    assert isinstance(frame["period"].dtype, pd.DatetimeTZDtype)
    assert str(frame["events"].dtype) == "Int64" and frame["error_rate"].dtype == "float64"
    assert len(frame) == 31
    ((events,),) = raw("SELECT count() FROM events WHERE $PERIOD")
    assert int(frame["events"].sum()) == events


def test_breakdown_by_plan_matches_a_hand_written_join(raw) -> None:
    frame = q.breakdown(OCTOBER, "tenant.plan")
    expected = raw(
        "SELECT t.plan, count() AS c FROM events AS e INNER JOIN tenants AS t ON e.tenant_id = t.tenant_id "
        "WHERE e.$PERIOD GROUP BY t.plan ORDER BY c DESC"
    )
    assert list(zip(frame["tenant.plan"], frame["events"].astype(int), strict=True)) == [tuple(r) for r in expected]


def test_tenant_scope_and_filters(raw) -> None:
    scoped = q.Filters(OCTOBER.start, OCTOBER.end, tenant_id=170, devices=("desktop", "api"))
    ((events, users),) = raw(
        "SELECT count(), uniqExact(user_id) FROM events WHERE tenant_id = 170 AND device IN ('desktop', 'api') AND $PERIOD"
    )
    k = q.kpis(scoped)
    assert (k["events"], k["active_users"]) == (events, users)
    assert set(k) == set(q.KPI_MEASURES)
    assert q.options("device") == ["api", "desktop", "mobile", "tablet"]
    assert q.options("plan") == ["enterprise", "free", "growth", "starter"]
    with pytest.raises(ValueError, match="grain"):
        q.timeseries(OCTOBER, "hour")
