"""The rendered dashboard, driven headlessly with Streamlit's AppTest (no browser)."""

from __future__ import annotations

from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = str(Path(__file__).resolve().parent.parent / "app.py")


def render() -> AppTest:
    at = AppTest.from_file(APP, default_timeout=60).run()
    assert not at.exception, at.exception
    return at


def metrics(at: AppTest) -> dict[str, str]:
    return {m.label: m.value for m in at.metric}


def test_default_view_matches_raw_sql(raw) -> None:
    at = render()
    ((events, users, errors),) = raw("SELECT count(), uniqExact(user_id), countIf(status_code >= 500) FROM events WHERE $PERIOD")
    shown = metrics(at)
    assert list(shown) == ["Events", "Active users", "Error rate", "p95 latency"]
    assert shown["Events"] == f"{events:,}"
    assert shown["Active users"] == f"{users:,}"
    assert shown["Error rate"] == f"{errors / events:.2%}"
    assert shown["p95 latency"].endswith(" ms")
    assert [s.value for s in at.subheader] == ["Events and active users by day", "By device", "By plan", "Top paths"]
    assert len(at.dataframe) == 1 and len(at.dataframe[0].value) == 10  # top 10 paths
    assert len(at.get("download_button")) == 1


def test_tenant_and_device_filters_rerun_the_queries(raw) -> None:
    at = render()
    at.sidebar.selectbox[0].select(153).run()
    ((events,),) = raw("SELECT count() FROM events WHERE tenant_id = 153 AND $PERIOD")
    assert metrics(at)["Events"] == f"{events:,}"
    assert at.caption[0].value.startswith("Quartz Metrics")

    at.sidebar.multiselect[1].select("mobile").run()  # Device
    ((mobile,),) = raw("SELECT count() FROM events WHERE tenant_id = 153 AND device = 'mobile' AND $PERIOD")
    assert metrics(at)["Events"] == f"{mobile:,}"


def test_plan_filter_goes_through_the_tenants_relationship(raw) -> None:
    at = render()
    at.sidebar.multiselect[0].select("growth").run()  # Plan
    ((events,),) = raw(
        "SELECT count() FROM events WHERE tenant_id IN (SELECT tenant_id FROM tenants WHERE plan = 'growth') AND $PERIOD"
    )
    assert metrics(at)["Events"] == f"{events:,}"
