# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "marimo>=0.25",
#     "hypequery[chdb,pandas]",
#     "altair>=5",
# ]
# ///
"""A semantic layer over ClickHouse, in a notebook, with no server.

Run it with marimo (``uvx marimo edit --sandbox marimo_chdb.py``) or as a plain
script (``python marimo_chdb.py``). chDB embeds the ClickHouse engine in the
process, so everything below runs on your laptop with no credentials.
"""

import marimo

__generated_with = "0.25.2"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo

    return (mo,)


@app.cell
def _(mo):
    mo.md(
        r"""
        # A semantic layer over ClickHouse, with no server

        [chDB](https://github.com/chdb-io/chdb) runs the ClickHouse engine inside this Python
        process. [hypequery](https://hypequery.com/docs/python) sits on top: you define a dataset
        once (dimensions, measures, a tenant key) and then query it by name. The SQL is generated,
        parameterized and tenant-scoped for you.

        Three cells: create some data, define the dataset, ask questions.
        """
    )
    return


@app.cell
def _():
    import chdb

    from hypequery.execution import create_chdb_executor

    # The executor opens an in-memory ClickHouse. Keep it open for the notebook's
    # lifetime; a second connection to ":memory:" shares the same database.
    executor = create_chdb_executor()

    setup = chdb.connect(":memory:")
    setup.query(
        """
        CREATE TABLE IF NOT EXISTS orders
        (
            id String,
            tenant_id LowCardinality(String),
            country LowCardinality(String),
            status LowCardinality(String),
            amount Decimal(12, 2),
            created_at DateTime('UTC')
        )
        ENGINE = MergeTree
        ORDER BY (tenant_id, created_at, id)
        """
    )
    setup.query(
        """
        INSERT INTO orders
        SELECT
            concat('o', toString(number)) AS id,
            concat('tenant_', toString(number % 3 + 1)) AS tenant_id,
            ['NZ', 'AU', 'US', 'GB', 'DE'][number % 5 + 1] AS country,
            if(number % 11 = 0, 'refunded', 'paid') AS status,
            toDecimal64(20 + (cityHash64(number) % 48000) / 100, 2) AS amount,
            toDateTime('2026-01-01 00:00:00', 'UTC') + toIntervalMinute(number * 9) AS created_at
        FROM numbers(50000)
        """
    )
    row_count = setup.query("SELECT count() FROM orders", "CSV").bytes().decode().strip()
    setup.close()
    return executor, row_count


@app.cell
def _(mo, row_count):
    mo.md(
        f"**{row_count} orders** across three tenants, five countries and ten months, "
        "all in memory."
    )
    return


@app.cell
def _(executor):
    from hypequery.datasets import create_dataset_client, dataset, dimension, measure

    orders = dataset(
        "orders",
        source="orders",
        description="One row per customer order.",
        tenant_key="tenant_id",
        time_key="created_at",
        dimensions={
            "country": dimension.string(),
            "status": dimension.string(),
            "createdAt": dimension.timestamp(column="created_at"),
        },
        measures={
            "revenue": measure.sum("amount"),
            "orderCount": measure.count("id"),
        },
    )

    analytics = create_dataset_client(executor=executor)
    return analytics, orders


@app.cell
def _(mo):
    mo.md(
        r"""
        ## Ask questions by name

        No SQL from here on. Every query names dimensions and measures from the definition above,
        and runs for one tenant: the `tenant_id` filter is added for you, every time.
        """
    )
    return


@app.cell
def _(mo):
    tenant_picker = mo.ui.dropdown(
        options=["tenant_1", "tenant_2", "tenant_3"], value="tenant_1", label="Tenant"
    )
    tenant_picker
    return (tenant_picker,)


@app.cell
def _(analytics, mo, orders, tenant_picker):
    from hypequery.datasets import DatasetQuery, ExecutionContext, filter, order, tenant

    by_country = analytics.execute(
        orders,
        DatasetQuery(
            dimensions=("country",),
            measures=("revenue", "orderCount"),
            filters=(filter.eq("status", "paid"),),
            order_by=(order.desc("revenue"),),
        ),
        context=ExecutionContext(tenant=tenant(tenant_picker.value)),
    )
    country_frame = by_country.to_pandas()
    mo.ui.table(country_frame, selection=None)
    return DatasetQuery, ExecutionContext, country_frame, tenant


@app.cell
def _(mo):
    mo.md(
        r"""
        ## Time grains

        The dataset has a `time_key`, so pass `by="month"` and the planner buckets the results
        in the query's time zone. Swap `month` for `week`, `day` or `hour`; the definition
        does not change.
        """
    )
    return


@app.cell
def _(DatasetQuery, ExecutionContext, analytics, orders, tenant, tenant_picker):
    import altair as alt

    monthly = analytics.execute(
        orders,
        DatasetQuery(by="month", dimensions=("country",), measures=("revenue",)),
        context=ExecutionContext(tenant=tenant(tenant_picker.value)),
    )
    monthly_frame = monthly.to_pandas()
    monthly_frame["revenue"] = monthly_frame["revenue"].astype(float)

    chart = (
        alt.Chart(monthly_frame)
        .mark_bar()
        .encode(
            x=alt.X("period:T", title="Month"),
            y=alt.Y("revenue:Q", title="Revenue"),
            color=alt.Color("country:N", title="Country"),
            tooltip=["period:T", "country:N", "revenue:Q"],
        )
        .properties(height=280)
    )
    chart
    return (chart,)


@app.cell
def _(mo):
    mo.md(
        r"""
        ## From here

        - **Production:** swap `create_chdb_executor()` for
          `create_clickhouse_executor(ClickHouseConnection.from_env())`. Nothing else changes.
        - **An API:** `hypequery.serve` turns the same dataset into authenticated,
          tenant-scoped HTTP endpoints that mount in FastAPI or run natively in Django and Flask.
        - **Agents:** the served endpoints feed a governed MCP server, so an agent asks
          for `revenue` by `country` and never writes SQL.
        - **Your own files:** chDB reads Parquet and CSV through ClickHouse table functions.
          Create a view over `file('orders.parquet')` and point the dataset's `source` at it.

        Docs: [hypequery.com/docs/python](https://hypequery.com/docs/python)
        """
    )
    return


if __name__ == "__main__":
    app.run()
