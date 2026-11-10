# A governed Streamlit dashboard on ClickHouse with pandas export

Build a Streamlit dashboard on ClickHouse that reads only typed hypequery datasets: filters, a time series, breakdowns and a pandas CSV export.

## Demo

```bash
uv run streamlit run app.py      # http://localhost:8501
```

```text
Filters                 Product analytics
───────                 All tenants · 2026-10-01 to 2026-10-31
Tenant  [All tenants]
Period  [2026-10-01 – 31]   Events     Active users   Error rate   p95 latency
Plan    [ ]                 139,744    2,154          2.41%        844 ms
Device  [ ]
Grain   (•) day ( ) week    Events and active users by day   (line chart)
        ( ) month           By device (bar)        By plan (bar, via tenants join)
                            Top paths (table)      [Download time series (CSV)]
```

Pick "Quartz Metrics" and every number is re-queried for tenant 153; add "mobile" under Device and they narrow again. The same queries work without Streamlit, as DataFrames:

```bash
uv run python -c "from datetime import date; from analytics import queries as q; print(q.kpis(q.Filters(date(2026, 10, 1), date(2026, 10, 31))))"
# {'events': 139744, 'active_users': 2154, 'error_rate': 0.024058277994046254, 'p95_latency_ms': 844.45}   # p95 is sampled; see Adapt it
```

```text
period,events,active_users,error_rate        # the CSV export, by week
2026-09-27 00:00:00+00:00,12459,1326,0.0251
2026-10-04 00:00:00+00:00,31239,1613,0.0237
...
```

## Install

```bash
npx @hypequery/cli create streamlit-dashboard -y
cd streamlit-dashboard
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
uv sync
uv run streamlit run app.py
```

`uv` is the only Python requirement (`pip install uv`, or see astral.sh/uv). `uv run pytest -q` runs the tests against the seed, headlessly.

## What it shows

- **Numbers defined once** (`analytics/datasets.py`): `events` and `tenants` datasets with `events`, `active_users`, `p95_latency_ms` and a derived `error_rate`. The page asks for them by name, so a chart, a metric and the CSV can never disagree about what "error rate" means. Raw-SQL Streamlit apps repeat that logic in every `st.cache_data` query.
- **Filters as dataset fields, not string-built SQL** (`analytics/queries.py`): the sidebar becomes `between`/`in` filters on `occurred_at`, `device` and `tenant.plan`, sent as bound parameters. `tenant.plan` crosses a `belongs_to` relationship, so hypequery writes the join to `tenants`.
- **An explicit tenant scope** (`Filters.context`): "All tenants" runs with `all_tenants()`, one tenant with `tenant("153")`. The datasets have a `tenant_key`, so a query with no scope is refused rather than silently reading everything.
- **pandas out of the box** (`result.to_pandas()`): typed frames (`period` as `datetime64[us, UTC]`, counts as `Int64`, ratios as `float64`) feed `st.line_chart`, `st.bar_chart`, `st.dataframe` and the `st.download_button` CSV.
- **Tested without a browser** (`tests/`): `streamlit.testing.v1.AppTest` renders the page, changes the sidebar, and checks the rendered metrics against raw SQL; a second file checks the DataFrames directly.

## Key file

`app.py` is the whole page; it never sees SQL:

```python
with st.sidebar:
    st.header("Filters")
    names = cached(q.tenant_names)()
    tenant_id = st.selectbox("Tenant", [None, *names], format_func=lambda t: "All tenants" if t is None else names[t])
    period = st.date_input("Period", (date(2026, 10, 1), date(2026, 10, 31)),
                           min_value=date(2025, 11, 1), max_value=date(2026, 10, 31))
    plans = st.multiselect("Plan", cached(q.options)("plan"))
    devices = st.multiselect("Device", cached(q.options)("device"))
    grain = st.radio("Time grain", q.GRAINS, horizontal=True)

f = q.Filters(period[0], period[1], tenant_id, tuple(plans), tuple(devices))

k = cached(q.kpis)(f)
c1, c2, c3, c4 = st.columns(4)
c1.metric("Events", f"{k['events']:,}")
c2.metric("Active users", f"{k['active_users']:,}")
c3.metric("Error rate", "n/a" if k["error_rate"] is None else f"{k['error_rate']:.2%}")
c4.metric("p95 latency", "n/a" if k["p95_latency_ms"] is None else f"{k['p95_latency_ms']:,.0f} ms")

series = cached(q.timeseries)(f, grain)
st.line_chart(series, x="period", y=["events", "active_users"])
...
st.download_button("Download time series (CSV)", series.to_csv(index=False),
                   file_name=f"events-by-{grain}-{f.start}-{f.end}.csv", mime="text/csv")
```

and each helper in `analytics/queries.py` is one semantic query:

```python
def timeseries(f: Filters, grain: str = "day") -> pd.DataFrame:
    query = {"measures": ["events", "active_users", "error_rate"], "by": grain, "filters": f.to_query()}
    return client().execute(events, query, context=f.context()).to_pandas()
```

## Architecture

```text
Streamlit (app.py, reruns on every widget change)          analytics/                         ClickHouse
──────────────────────────────────────────────            ──────────                         ──────────
sidebar widgets ─▶ Filters(start, end, tenant, plans, devices)
st.cache_data(ttl=300) ─▶ q.kpis / q.timeseries / q.breakdown
                             └─ client().execute(events, {measures, by, filters}, context=tenant scope)
                                  └─ datasets.py: measures, dimensions, tenant_key, tenant relationship
                                       └─ SELECT count(), uniqExact(user_id), quantile(0.95)(latency_ms) ...
                                          FROM events LEFT ANY JOIN tenants ... WHERE ...  ──────────────▶
st.metric / st.line_chart / st.bar_chart / st.dataframe ◀── result.to_pandas()
st.download_button ◀── DataFrame.to_csv()
```

## Adapt it

- **A customer-facing dashboard.** Drop the tenant selectbox and build `Filters(tenant_id=...)` from your login (Streamlit's `st.user` with OIDC, or your proxy's header). The scope is fixed before any query runs, so a user cannot widen it from the page.
- **Polars or Arrow.** Swap `to_pandas()` for `to_polars()` or `to_arrow()` (install `hypequery[polars]` or `hypequery[arrow]`); Streamlit's charts accept both.
- **Your own tables.** Run `hypequery init` against your ClickHouse to generate dataset definitions, then point `analytics/queries.py` at them. Add a measure in `datasets.py` and it is available to every chart at once.
- **Exact percentiles.** `quantile(0.95)` is ClickHouse's sampled estimate, so p95 moves by a few ms between runs; the tests check its unit, not its value. Counts and distinct users are exact (`count`, `uniqExact`).
- **Caching.** `st.cache_data(ttl=300)` keys on the `Filters` dataclass, so identical filter combinations cost one round trip per five minutes. Shorten it for live data, or add hypequery's own result cache (`create_memory_cache_store`) to share results across sessions.
- **Deploy.** `streamlit run app.py --server.headless true` in a container, or Streamlit Community Cloud with `CLICKHOUSE_*` in its secrets as environment variables.

## Related recipes

- [p95-latency](../../recipes/p95-latency): the `p95_latency_ms` measure, explained.

## Related examples

- [django-analytics](../django-analytics): the same measures served as tenant-scoped JSON from Django views.
- [fastapi-analytics-api](../fastapi-analytics-api): the same datasets behind a FastAPI API with JWT tenant scoping.

Tested on ClickHouse 25.8 with `hypequery` 0.1.0b3 (PyPI), Streamlit 1.67, pandas 3.1 and Python 3.12.
