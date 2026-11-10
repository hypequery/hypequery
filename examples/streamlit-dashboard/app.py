"""A Streamlit dashboard that reads only hypequery datasets.

Run: uv run streamlit run app.py
"""

from datetime import date

import streamlit as st

from analytics import queries as q

st.set_page_config(page_title="Product analytics", page_icon=":bar_chart:", layout="wide")
cached = st.cache_data(ttl=300, show_spinner=False)  # same filters, no second round trip

with st.sidebar:
    st.header("Filters")
    names = cached(q.tenant_names)()
    tenant_id = st.selectbox("Tenant", [None, *names], format_func=lambda t: "All tenants" if t is None else names[t])
    period = st.date_input("Period", (date(2026, 10, 1), date(2026, 10, 31)),
                           min_value=date(2025, 11, 1), max_value=date(2026, 10, 31))
    plans = st.multiselect("Plan", cached(q.options)("plan"))
    devices = st.multiselect("Device", cached(q.options)("device"))
    grain = st.radio("Time grain", q.GRAINS, horizontal=True)

if len(period) != 2:
    st.info("Pick an end date.")
    st.stop()
f = q.Filters(period[0], period[1], tenant_id, tuple(plans), tuple(devices))

st.title("Product analytics")
st.caption(f"{'All tenants' if tenant_id is None else names[tenant_id]} · {f.start} to {f.end}")

k = cached(q.kpis)(f)
c1, c2, c3, c4 = st.columns(4)
c1.metric("Events", f"{k['events']:,}")
c2.metric("Active users", f"{k['active_users']:,}")
c3.metric("Error rate", "n/a" if k["error_rate"] is None else f"{k['error_rate']:.2%}")
c4.metric("p95 latency", "n/a" if k["p95_latency_ms"] is None else f"{k['p95_latency_ms']:,.0f} ms")

series = cached(q.timeseries)(f, grain)
st.subheader(f"Events and active users by {grain}")
st.line_chart(series, x="period", y=["events", "active_users"])

left, right = st.columns(2)
with left:
    st.subheader("By device")
    st.bar_chart(cached(q.breakdown)(f, "device"), x="device", y="events")
with right:
    st.subheader("By plan")
    st.bar_chart(cached(q.breakdown)(f, "tenant.plan"), x="tenant.plan", y="events")

st.subheader("Top paths")
paths = cached(q.breakdown)(f, "path")
st.dataframe(paths, hide_index=True, column_config={"error_rate": st.column_config.NumberColumn(format="percent")})

st.download_button("Download time series (CSV)", series.to_csv(index=False),
                   file_name=f"events-by-{grain}-{f.start}-{f.end}.csv", mime="text/csv")
