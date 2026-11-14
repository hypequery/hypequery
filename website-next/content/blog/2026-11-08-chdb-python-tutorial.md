---
title: "chDB in Python: from in-process queries to a metrics API"
description: "A working chDB tutorial for Python: install it, query Parquet, CSV and pandas with ClickHouse SQL, keep MergeTree tables on disk, then run the same metric definitions on chDB and on a ClickHouse server."
seoTitle: "chDB Python Tutorial: Embedded ClickHouse in Python"
seoDescription: "chDB runs ClickHouse inside your Python process: pip install chdb, then chdb.query(). Query Parquet, CSV and pandas, keep MergeTree tables, serve metrics."
pubDate: 2026-11-08
updatedAt: 2026-11-08
heroImage: ""
slug: chdb-python-tutorial
status: published
tags:
  - ClickHouse
  - Python
---

chDB is the ClickHouse database engine packaged as a Python library, so ClickHouse SQL runs inside your Python process with no server to install or connect to. Install it with `pip install chdb` and run a query with `chdb.query("SELECT version()")`. It reads Parquet, CSV and pandas DataFrames, keeps MergeTree tables on disk between runs, and has been part of ClickHouse since March 2024 ([announcement](https://clickhouse.com/blog/chdb-joins-clickhouse-family)).

Everything below was run on chDB 4.4.0 (ClickHouse engine 26.9.2.1), Python 3.14 on macOS, and every output is copied from the terminal. The last part runs one set of metric definitions on chDB and then on a ClickHouse 26.6 server, with the same results.

## How do you install chDB and run a first query?

Install chDB from PyPI with `pip install chdb`, then call `chdb.query()` with a SQL string. The [chDB README](https://github.com/chdb-io/chdb) lists Python 3.9+ on macOS and Linux (x86_64 and ARM64); the PyPI wheels for 4.4.0's engine package, `chdb-core` 26.9.0, cover exactly those four platforms, with no Windows build.

```bash
pip install chdb
```

```python
import chdb

print(chdb.__version__)
print(chdb.query("SELECT version() AS engine, 1 + 1 AS two"))
```

```text
4.4.0
"26.9.2.1",2
```

The first line is the Python package version and the second is the ClickHouse engine version inside it. chDB 4.4.0 installs `chdb-core`, pandas and pyarrow as dependencies. The engine is large: the installed `chdb` package took 366 MB on disk on macOS arm64, which matters if you deploy to a size-limited target such as a serverless function.

## What is chDB used for?

chDB is used where you want ClickHouse SQL without running a ClickHouse server. The cases this guide works through:

- Querying Parquet, CSV and DataFrames from a script or notebook with ClickHouse SQL and functions.
- Test suites and CI jobs that need a real ClickHouse engine. The pytest fixture below creates a MergeTree table in memory, and the test passed in 0.42 seconds with no container.
- Local development on an on-disk database, with queries that later run unchanged on a ClickHouse server.
- Small services and serverless functions, as long as the deployment can carry the engine's size (366 MB installed, measured above) and runs one process per database.

If you already run a ClickHouse server and only need a client, use a driver such as `clickhouse-connect` instead. chDB runs the engine in your process; a driver talks to a server.

## Which output formats can chdb.query return?

`chdb.query(sql, format)` returns CSV text by default, and the second argument takes a ClickHouse output format name, such as `"JSONEachRow"` or `"PrettyCompact"`, or one of two Python-specific ones, `"DataFrame"` (pandas) and `"ArrowTable"` (pyarrow). The README says chDB reads and writes "Parquet, CSV, JSON, Arrow, ORC and 60+" formats.

```python
import chdb

print(chdb.query(
    "SELECT toStartOfMonth(toDate('2026-11-08')) AS month, formatReadableSize(1048576) AS size",
    "PrettyCompact",
))

df = chdb.query("SELECT number, number * 2 AS doubled FROM numbers(3)", "DataFrame")
print(df)

table = chdb.query("SELECT number FROM numbers(3)", "ArrowTable")
print(table.schema)
```

```text
   ┌──────month─┬─size─────┐
1. │ 2026-11-01 │ 1.00 MiB │
   └────────────┴──────────┘

   number  doubled
0       0        0
1       1        2
2       2        4
number: uint64 not null
```

`toStartOfMonth`, `formatReadableSize` and the `numbers()` table function are ClickHouse built-ins, and they work unchanged because the engine is ClickHouse. Use `"PrettyCompact"` while exploring, `"DataFrame"` when the next step is pandas, and `"ArrowTable"` when you want typed columns without a pandas copy: the `uint64` column above keeps the ClickHouse `UInt64` type.

## How do you query Parquet and CSV files with chDB?

Pass the path to the `file()` table function and chDB infers the schema from the file. To have something to query, write a five-row orders table to both formats with pandas:

```python
import pandas as pd

orders = pd.DataFrame({
    "id": ["o1", "o2", "o3", "o4", "o5"],
    "country": ["NZ", "NZ", "AU", "AU", "US"],
    "status": ["paid", "paid", "paid", "refunded", "paid"],
    "amount": [120.50, 80.00, 200.00, 50.00, 310.25],
    "created_at": pd.to_datetime([
        "2026-09-01 10:00:00", "2026-09-02 11:30:00", "2026-09-02 12:00:00",
        "2026-09-03 09:15:00", "2026-09-04 16:45:00",
    ]),
})
orders.to_parquet("/tmp/orders.parquet", index=False)
orders.to_csv("/tmp/orders.csv", index=False)
```

`DESCRIBE` shows what chDB inferred, and the file then works like a table in `FROM`:

```python
import chdb

print(chdb.query(
    "DESCRIBE file('/tmp/orders.parquet') SETTINGS describe_compact_output = 1",
    "PrettyCompact",
))

print(chdb.query("""
    SELECT country, count() AS orders, sum(amount) AS revenue
    FROM file('/tmp/orders.parquet')
    WHERE status = 'paid'
    GROUP BY country
    ORDER BY revenue DESC
""", "PrettyCompact"))

print(chdb.query("""
    SELECT toDate(created_at) AS day, sum(amount) AS revenue
    FROM file('/tmp/orders.csv', 'CSVWithNames')
    GROUP BY day
    ORDER BY day
""", "PrettyCompact"))
```

```text
   ┌─name───────┬─type───────────────────────────┐
1. │ id         │ Nullable(String)               │
2. │ country    │ Nullable(String)               │
3. │ status     │ Nullable(String)               │
4. │ amount     │ Nullable(Float64)              │
5. │ created_at │ Nullable(DateTime64(6, 'UTC')) │
   └────────────┴────────────────────────────────┘

   ┌─country─┬─orders─┬─revenue─┐
1. │ US      │      1 │  310.25 │
2. │ NZ      │      2 │   200.5 │
3. │ AU      │      1 │     200 │
   └─────────┴────────┴─────────┘

   ┌────────day─┬─revenue─┐
1. │ 2026-09-01 │   120.5 │
2. │ 2026-09-02 │     280 │
3. │ 2026-09-03 │      50 │
4. │ 2026-09-04 │  310.25 │
   └────────────┴─────────┘
```

Inferred columns come back `Nullable`, and the money column is `Float64` because that is what pandas wrote. When exact types matter, load the file into a table with an explicit schema, as in the session section below. The second argument to `file()` names the format; `CSVWithNames` reads the first line as column names. The [file table function docs](https://clickhouse.com/docs/sql-reference/table-functions/file) cover globs and the other arguments.

## How do you query a pandas DataFrame with chDB?

Wrap the DataFrame variable in the `Python()` table function: `SELECT ... FROM Python(df)`. chDB looks up the variable `df` by name and queries it as a table.

```python
import chdb
import pandas as pd

df = pd.read_parquet("/tmp/orders.parquet")

out = chdb.query("""
    SELECT status, count() AS orders, avg(amount) AS avg_amount
    FROM Python(df)
    GROUP BY status
    ORDER BY status
""", "DataFrame")
print(out)
print(out.dtypes)
```

```text
     status  orders  avg_amount
0      paid       4    177.6875
1  refunded       1     50.0000
status            str
orders         uint64
avg_amount    float64
dtype: object
```

Writing the bare name (`FROM df`) failed in chDB 4.4.0 with `Unknown table expression identifier 'df'` when I ran it as a script, so use `Python(df)`. `count()` arrives as `uint64` because ClickHouse returns `UInt64` for counts.

## How do you keep tables between chDB queries?

Open a connection with `chdb.connect(path)`. Tables you create through it live in that directory and are there the next time any process opens it. Plain `chdb.query()` calls don't share tables: a table created in one call was gone in the next, which failed with `Unknown table expression identifier 't'`. Use a connection for anything with `CREATE TABLE`.

```python
import chdb

conn = chdb.connect("/tmp/shop.chdb")
conn.query("""
    CREATE TABLE IF NOT EXISTS orders
    (
        id String,
        country LowCardinality(String),
        status LowCardinality(String),
        amount Decimal(12, 2),
        created_at DateTime64(3, 'UTC')
    )
    ENGINE = MergeTree
    ORDER BY (created_at, id)
""")
conn.query("INSERT INTO orders SELECT * FROM file('/tmp/orders.parquet')")

print(conn.query(
    "SELECT engine, total_rows FROM system.tables WHERE name = 'orders'",
    "PrettyCompact",
))

cur = conn.cursor()
cur.execute("SELECT id, amount FROM orders WHERE country = 'NZ' ORDER BY id")
print(cur.fetchall())
conn.close()
```

```text
   ┌─engine────┬─total_rows─┐
1. │ MergeTree │          5 │
   └───────────┴────────────┘

(('o1', Decimal('120.5')), ('o2', Decimal('80')))
```

The `INSERT ... SELECT` converts the Parquet file's nullable floats into the table's `Decimal(12, 2)` column, and the cursor returns them as Python `Decimal`. A second Python process that opens `/tmp/shop.chdb` and runs `SELECT count() FROM orders` gets `5`. Pass `":memory:"` instead of a path for a database that disappears when the last connection closes.

The older `chdb.session.Session(path)` API still works in 4.4.0. In the package source it wraps the same connection class that `chdb.connect` returns, so pick either; this guide uses `connect`.

Three limits showed up while testing:

- One database path per process. With `/tmp/shop.chdb` open, connecting to a second path raised `EmbeddedServer already initialized with path '/tmp/shop.chdb', cannot connect with different path`. It worked after closing the first connection.
- One process per on-disk database. A second process that opened `/tmp/shop.chdb` while the first held it failed with `Error initializing EmbeddedServer`.
- The directory is a ClickHouse data directory. chDB uses the same storage format as `clickhouse local` ([ClickHouse blog](https://clickhouse.com/blog/chdb-joins-clickhouse-family)), and `clickhouse local --path /tmp/shop.chdb` read the table above with the same totals.

## How do you run the same metrics on chDB and on a ClickHouse server?

Define the metrics once in code, then choose the engine when you create the executor. With hypequery's Python SDK, a dataset declares dimensions and measures over a table, and the same dataset runs on chDB (tests, notebooks, CI) or on a ClickHouse server (production) by swapping one constructor. Install it with the `chdb` extra, plus `clickhouse` for the server driver:

```bash
pip install "hypequery[chdb,clickhouse]==0.1.0b3"
```

The dataset, in `metrics.py` (a name that won't clash with the `datasets` package if you have it installed):

```python
from hypequery.datasets import dataset, dimension, formula, measure

orders = dataset(
    "orders",
    source="orders",
    time_key="created_at",
    dimensions={
        "country": dimension.string(),
        "status": dimension.string(),
        "createdAt": dimension.timestamp(column="created_at"),
    },
    measures={
        "revenue": measure.sum("amount"),
        "orderCount": measure.count("id"),
        "averageOrderValue": measure.derived(
            formula.divide("revenue", formula.null_if_zero("orderCount")),
        ),
    },
)
```

A script that runs a query against whichever engine the environment points at:

```python
import os

from hypequery.datasets import DatasetQuery, create_dataset_client, filter, order
from hypequery.execution import (
    ClickHouseConnection,
    create_chdb_executor,
    create_clickhouse_executor,
)

from metrics import orders


def make_executor():
    if os.environ.get("CLICKHOUSE_URL"):
        return create_clickhouse_executor(ClickHouseConnection.from_env())
    return create_chdb_executor("/tmp/shop.chdb")


query = DatasetQuery(
    dimensions=("country",),
    measures=("revenue", "orderCount", "averageOrderValue"),
    filters=(filter.eq("status", "paid"),),
    order_by=(order.desc("revenue"),),
)

with make_executor() as executor:
    analytics = create_dataset_client(executor=executor)
    for row in analytics.execute(orders, query).data:
        print(row)
```

On chDB, reading the `/tmp/shop.chdb` table from the previous section:

```text
{'country': 'US', 'revenue': '310.25', 'orderCount': 1, 'averageOrderValue': 310.25}
{'country': 'NZ', 'revenue': '200.50', 'orderCount': 2, 'averageOrderValue': 100.25}
{'country': 'AU', 'revenue': '200.00', 'orderCount': 1, 'averageOrderValue': 200.0}
```

For the production half I started a local ClickHouse 26.6.2 server, created the same `orders` table with the same five rows through `clickhouse client`, and ran the unchanged script with one environment variable set:

```bash
CLICKHOUSE_URL=clickhouse://default@127.0.0.1:18123/default python run.py
```

```text
{'country': 'US', 'revenue': '310.25', 'orderCount': 1, 'averageOrderValue': 310.25}
{'country': 'NZ', 'revenue': '200.50', 'orderCount': 2, 'averageOrderValue': 100.25}
{'country': 'AU', 'revenue': '200.00', 'orderCount': 1, 'averageOrderValue': 200.0}
```

The rows match, including types: the `Decimal` sum comes back as a string with its scale, the count as `int` and the derived ratio as `float`, as the [execution docs](/docs/python/datasets/execution) describe. A daily breakdown, `DatasetQuery(by="day", measures=("revenue", "orderCount"))`, converted with `result.to_pandas()`, also gave identical frames on both engines, with `period` as `datetime64[us, UTC]`, `revenue` as `float64` and `orderCount` as `Int64`.

To see what runs, `analytics.to_sql(orders, query)` prints the compiled statement. For revenue and average order value by country:

```text
SELECT `__hq_base`.`country` AS `country`, sum(`__hq_base`.`amount`) AS `revenue`, (toFloat64(sum(`__hq_base`.`amount`)) / NULLIF(count(`__hq_base`.`id`), 0)) AS `averageOrderValue` FROM `orders` AS `__hq_base` WHERE `__hq_base`.`status` = <p0:String> GROUP BY `country`
```

`<p0:String>` is a ClickHouse query parameter: the value travels separately from the SQL on both engines.

### Using chDB as a pytest fixture

An in-memory chDB database makes a test fixture with no container. Keep the executor open for the test's lifetime, because closing the last connection discards an in-memory database:

```python
import chdb
import pytest

from hypequery.datasets import DatasetQuery, create_dataset_client
from hypequery.execution import create_chdb_executor

from metrics import orders


@pytest.fixture
def analytics():
    with create_chdb_executor() as executor:  # in-memory
        setup = chdb.connect(":memory:")
        setup.query("""
            CREATE TABLE orders (
                id String, country String, status String,
                amount Decimal(12, 2), created_at DateTime64(3, 'UTC')
            ) ENGINE = MergeTree ORDER BY id
        """)
        setup.query("""
            INSERT INTO orders VALUES
                ('o1', 'NZ', 'paid', 120.50, '2026-09-01 10:00:00'),
                ('o2', 'NZ', 'refunded', 80.00, '2026-09-02 11:30:00')
        """)
        setup.close()
        yield create_dataset_client(executor=executor)


def test_revenue_by_status(analytics):
    result = analytics.execute(
        orders, DatasetQuery(dimensions=("status",), measures=("revenue",))
    )
    assert sorted(result.data, key=lambda r: r["status"]) == [
        {"status": "paid", "revenue": "120.50"},
        {"status": "refunded", "revenue": "80.00"},
    ]
```

```text
1 passed in 0.42s
```

### Load files into tables before pointing a dataset at them

hypequery runs every dataset query with the ClickHouse setting `readonly = 1`, and ClickHouse refuses the `file()` table function in that mode, even behind a view:

```python
import chdb

conn = chdb.connect(":memory:")
conn.query("CREATE VIEW orders_file AS SELECT * FROM file('/tmp/orders.parquet')")
print(conn.query("SELECT sum(amount) FROM orders_file", "CSV"))
try:
    conn.query("SELECT sum(amount) FROM orders_file SETTINGS readonly = 1")
except Exception as e:
    print(e)
```

```text
760.75

Code: 164. DB::Exception: default: Cannot execute query in readonly mode. (READONLY)
```

A dataset over that view fails the same way. Copy the file into a MergeTree table with `INSERT ... SELECT FROM file(...)`, as in the session section, and point the dataset's `source` at the table. That also matches production, where the data lives in tables. The [chDB page in the Python docs](/docs/python/datasets/chdb) covers in-memory and on-disk paths and how the chDB executor differs from the server one.

## chDB vs DuckDB: which embedded engine should you use?

Choose chDB when your production data is in ClickHouse or will be, and DuckDB when it isn't and you want its dialect, ecosystem or Windows support. Both run analytical SQL inside the Python process ([DuckDB describes itself](https://duckdb.org/) as "in-process"). If you are weighing ClickHouse against DuckDB more broadly, this is the like-for-like comparison: DuckDB runs inside your process by default (its [Quack protocol](https://duckdb.org/quack/), introduced in 2026, adds a client-server mode), ClickHouse usually runs as a server (or ClickHouse Cloud) that many applications and users query at once, and chDB is ClickHouse in the in-process shape.

| | chDB 4.4.0 | DuckDB |
| --- | --- | --- |
| SQL dialect | ClickHouse SQL and its function library | "based on PostgreSQL" ([DuckDB docs](https://duckdb.org/docs/stable/sql/dialect/overview)) |
| Table engines | ClickHouse engines, including MergeTree (shown above) | DuckDB's own storage |
| Path to a ClickHouse server | Same SQL; the data directory opens with `clickhouse local` | A separate engine with its own dialect |
| Python wheels | macOS and Linux, x86_64 and ARM64 | Includes Windows (`win_amd64`, `win_arm64` wheels for 2.0.0 on PyPI) |
| Other languages | Go, Rust, Node.js, Bun, C and C++ ([ClickHouse docs](https://clickhouse.com/docs/chdb)) | See [duckdb.org](https://duckdb.org/) |

The main reason to pick chDB is what this guide showed: a query you write and test against chDB is ClickHouse SQL, so it runs on a ClickHouse server without translation, and the `numbers()` and `toStartOfMonth` calls above need no changes. If you test against DuckDB and deploy to ClickHouse, you maintain two dialects. If you never touch ClickHouse, that advantage disappears, and DuckDB's Windows wheels and [extensions](https://duckdb.org/docs/stable/extensions/overview) may matter more. I didn't run benchmarks for this guide, so there are no speed claims here; measure on your own data.

## How do you turn chDB metrics into an API?

Mount hypequery's Serve API in a FastAPI app over an async chDB executor, and the dataset above becomes an HTTP endpoint. This ran locally with FastAPI 0.162.2 and uvicorn 0.54.0:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI
from hypequery.datasets import create_async_dataset_client
from hypequery.execution import create_async_chdb_executor
from hypequery.serve import (
    HttpSecurity, Principal, ServeRequest, create_api, from_context, to_asgi_app,
)

from metrics import orders

executor = create_async_chdb_executor("/tmp/shop.chdb")
client = create_async_dataset_client(executor=executor)


def developer(request: ServeRequest) -> Principal:
    # Local development only: replace with jwt_strategy or your own auth.
    return Principal(subject="developer")


api = create_api(
    auth=from_context(developer, same_origin=False),
    client=client,
    datasets={"orders": orders},
    security=HttpSecurity(allowed_hosts=("127.0.0.1", "localhost")),
    client_mount_path="/analytics",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await executor.aclose()


app = FastAPI(lifespan=lifespan)
app.mount("/analytics", to_asgi_app(api))
```

Save it as `main.py` next to `metrics.py`. FastAPI and uvicorn aren't part of the earlier install, so add them, start the server, and query it from another terminal:

```bash
pip install fastapi "hypequery[server]==0.1.0b3"
uvicorn main:app --port 8000
```

```bash
curl -s -X POST http://127.0.0.1:8000/analytics/datasets/orders/query \
  -H "Content-Type: application/json" \
  -d '{"dimensions": ["country"], "measures": ["revenue", "orderCount"],
       "filters": [{"field": "status", "operator": "eq", "value": "paid"}],
       "orderBy": [{"field": "revenue", "direction": "desc"}]}'
```

```text
{"data":[{"country":"US","revenue":"310.25","orderCount":"1"},{"country":"NZ","revenue":"200.50","orderCount":"2"},{"country":"AU","revenue":"200.00","orderCount":"1"}]}
```

Over HTTP every measure is a string, `orderCount` included, as the [measures docs](/docs/python/datasets/measures) state. For production, swap in `create_async_from_sync_clickhouse_executor(ClickHouseConnection.from_env())` and real authentication, and run one server process: chDB's on-disk lock means several workers can't share the database. The [FastAPI guide](/clickhouse-fastapi) and the [FastAPI docs page](/docs/python/fastapi) cover JWT auth and calling the client from your own routes.

## Related

- [ClickHouse with Python](/clickhouse-python)
- [A semantic layer in Python](/python-semantic-layer)
- [hypequery Python docs](/docs/python)
- [Embedded ClickHouse (chDB) in the Python docs](/docs/python/datasets/chdb)
- [Introducing hypequery for Python](/blog/introducing-hypequery-python)
- [chDB on GitHub](https://github.com/chdb-io/chdb) and the [chDB docs on clickhouse.com](https://clickhouse.com/docs/chdb)
