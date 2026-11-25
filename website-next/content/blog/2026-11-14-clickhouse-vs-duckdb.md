---
title: "ClickHouse vs DuckDB: Which Analytical Database Should You Use?"
description: "ClickHouse vs DuckDB in 2026: a shared server or an engine inside your process, a 50-million-row test on both, SQL differences, Quack and chDB."
seoTitle: "ClickHouse vs DuckDB (2026): Benchmark, SQL and Use Cases"
seoDescription: "ClickHouse is a shared analytical server; DuckDB runs inside your process. A 50M-row test on both, SQL differences, Quack, chDB, and how to choose."
pubDate: 2026-11-14
updatedAt: 2026-11-25
heroImage: ""
slug: clickhouse-vs-duckdb
status: published
tags:
  - ClickHouse
  - DuckDB
  - Python
---

Use ClickHouse when many users, services or dashboards query the same large, constantly updated dataset, and DuckDB when one process (a notebook, a script, a data pipeline step, a desktop app) analyses data it can reach directly. Both are column-oriented SQL engines built for analytics, and both are open source. The real difference is where the engine runs: ClickHouse is a server that clients connect to, and DuckDB is a library that runs inside your process.

That line moved in 2026. DuckDB's Quack protocol lets DuckDB run as a server too, and chDB runs the ClickHouse engine inside a Python process. This guide covers both, with every DuckDB claim checked on duckdb.org on 14 November 2026, and a test of six queries on the same 50-million-row file in both engines, run on 25 November 2026.

## Quick answers

### Is ClickHouse faster than DuckDB?

On one machine, neither won every query in our test. Reading a Parquet file directly, DuckDB was 5 to 9 times faster on simple aggregations. With each engine using its own storage, ClickHouse was faster on an exact distinct count and on grouping by day, and DuckDB on small group-bys. A filter on ClickHouse's sort key took about 1 ms. The [test below](#clickhouse-vs-duckdb-performance-a-test-on-one-laptop) has the numbers. What one laptop can't show is ClickHouse spreading queries across a cluster, which DuckDB does not do.

### Can DuckDB replace ClickHouse?

For one user or one process analysing up to a single machine's worth of data, often yes. For a production service with many concurrent users, continuous inserts and data that outgrows one server, not today: DuckDB's own FAQ says its server mode, Quack, is in beta and not production-ready, and that it does not support distributed query processing.

### Is DuckDB a client-server database now?

It can be. Quack, introduced in DuckDB 1.5.3 and shipped in a polished version in DuckDB 2.0, lets one DuckDB process serve others over the network. DuckDB describes it as beta: usable for prototyping, with breaking changes to the protocol, function names and defaults expected.

### What is the in-process version of ClickHouse?

chDB. It packages the ClickHouse engine as a library for Python and other languages, so ClickHouse SQL runs inside your process with no server. It is the closest ClickHouse equivalent to using DuckDB.

## ClickHouse vs DuckDB at a glance

| | ClickHouse | DuckDB |
| --- | --- | --- |
| Where it runs | A server (or a cluster of servers) that clients connect to | Inside your process ([duckdb.org](https://duckdb.org/) calls it "in-process"); a server via Quack, in beta |
| Scaling | Shards and replicas across many servers | One machine; Quack does not distribute queries ([Quack FAQ](https://duckdb.org/quack/faq)) |
| Concurrent users | Built for many clients at once | One process by default; Quack adds multi-client access |
| Writes | High-volume inserts into MergeTree tables | Transactions on a local file; with Quack, "a few thousand writes per second" on an 8-CPU, 32 GB server, per DuckDB's FAQ |
| SQL dialect | ClickHouse SQL and its function library | "Based on PostgreSQL" ([DuckDB docs](https://duckdb.org/docs/stable/sql/dialect/overview)) |
| Managed service | ClickHouse Cloud and [other managed ClickHouse services](/blog/managed-clickhouse-services-compared) | MotherDuck (with its own protocol, not Quack) |
| In-process option | chDB | DuckDB itself |
| Licence | Apache 2.0 | MIT |

## When to choose DuckDB

- **Local analysis and notebooks.** Query Parquet, CSV or a DataFrame from Python or R without running anything else.
- **Pipeline steps.** Transform files inside a job and write the result somewhere else. Nothing to deploy or keep running.
- **Embedded in an application.** A desktop or edge app that analyses its own local data.
- **Windows.** DuckDB ships Windows wheels; chDB does not.

## When to choose ClickHouse

- **Customer-facing analytics.** Dashboards and APIs where many users query at once and every request needs an answer in milliseconds to seconds.
- **Continuously arriving data.** Events, logs and metrics inserted all day while queries run.
- **Data that outgrows one server.** Shards spread the data, replicas spread the reads.
- **Shared access.** One database that several services, a BI tool and an AI agent all query.

## ClickHouse vs DuckDB performance: a test on one laptop

We ran six common analytical queries on the same data in both engines, once against a Parquet file and once in each engine's own storage. It is one machine and one dataset, so treat it as a check on the pattern. Your own data and queries may come out differently.

**Setup.** An Apple M1 with 8 cores and 16 GB of RAM. ClickHouse 26.6.2 as `clickhouse local`, and DuckDB 2.0.1 from Python. Both used all cores, with default settings. The data was 50,000,000 synthetic events with 1,000,000 users, 4 event types, 8 countries and 83 days, written to one 357 MB Parquet file. For native storage we loaded the same rows into a ClickHouse MergeTree table with `ORDER BY (event_type, event_time)` and into a DuckDB database file. Each query ran once to warm up and then five times, and we took the median. The whole script ran five times, and the table shows the median of those five medians, rounded. The laptop was busy with other work during the runs, and some cells moved by up to 2× from one run to the next. Compare the engines, and don't read much into exact milliseconds. Both engines returned identical results for all six queries.

| Query (median ms) | ClickHouse on Parquet | ClickHouse MergeTree | DuckDB on Parquet | DuckDB table |
| --- | --- | --- | --- | --- |
| `count()` where `event_type = 'purchase'` | 470 | 1 | 50 | 40 |
| `sum(revenue)` by country (8 groups) | 470 | 190 | 80 | 50 |
| Events by day and type (332 groups) | 1,050 | 500 | 1,070 | 960 |
| Purchases and purchase revenue by country (`countIf` / `FILTER`) | 930 | 230 | 180 | 130 |
| `count(DISTINCT user_id)` (1,000,000 users) | 460 | 310 | 720 | 530 |
| Top 10 users by revenue (1,000,000 groups) | 1,160 | 830 | 970 | 790 |

What the numbers show:

- Straight off Parquet, DuckDB was faster on the filter and the small group-bys, by about 5 to 9 times. If your workflow is "point SQL at files", DuckDB is the stronger tool on one machine.
- For the filtered count, the sort key mattered more than the engine. The MergeTree table is sorted by `event_type`, so ClickHouse used the primary index to pick 1,527 of 6,104 granules. It then counted the exact ranges without reading the column (`_exact_count_projection` in `EXPLAIN`). With `optimize_use_implicit_projections = 0`, the same query took 16 ms.
- In native storage the results were mixed. ClickHouse was faster on the exact distinct count and on grouping by day. DuckDB was faster on the 8-group aggregations. The 1,000,000-group top-10 query was close.
- Storage was similar. The Parquet file was 357 MB, the DuckDB file 389 MB and the MergeTree table 533 MB, all with each engine's default compression. ClickHouse's default codec is LZ4, and ZSTD column codecs would make its table smaller.

None of this tests what decides most production choices, such as dozens of users querying at once, inserts arriving while queries run, and data larger than one server. That is where ClickHouse's server and cluster design applies, and where DuckDB's FAQ says Quack does not go.

## SQL differences between ClickHouse and DuckDB

Most analytical SQL runs on both engines. These were the differences that mattered in the test above. We checked each one on ClickHouse 26.6.2 and DuckDB 2.0.1.

| Task | ClickHouse | DuckDB |
| --- | --- | --- |
| Read a Parquet file | `FROM file('events.parquet')`. `clickhouse local` also accepts `FROM 'events.parquet'` | `FROM 'events.parquet'` or `read_parquet(...)` |
| Truncate a timestamp to a date | `toDate(ts)`. `CAST(ts AS DATE)` also works | `CAST(ts AS DATE)`. `toDate` does not exist |
| Conditional count | `countIf(cond)` or `count() FILTER (WHERE cond)` | `count(*) FILTER (WHERE cond)`, `count_if(cond)` or `countIf(cond)` |
| Approximate distinct count | `uniq(col)` | `approx_count_distinct(col)`. ClickHouse has no function by that name |
| 90th percentile | `quantile(0.9)(col)` is approximate (sampled), and can change between runs. Use `quantileExact(0.9)(col)` for an exact value | `quantile_cont(col, 0.9)` is exact, interpolated |

The last two rows matter most if you move queries between engines. On the same 50,000,000 rows, ClickHouse's `quantile(0.9)(revenue)` returned 89.68 on one run and 90.29 on the next, while `quantileExact(0.9)(revenue)` and DuckDB's `quantile_cont(revenue, 0.9)` both returned 90. The approximate distinct counts were 1,001,943 (`uniq`) and 982,272 (`approx_count_distinct`), against an exact 1,000,000. Both answers are correct for their functions, but a dashboard tested on one engine and served from the other will show different numbers. The same SQL on chDB and ClickHouse avoids this, as described [below](#where-chdb-fits).

## What Quack changes, and what it doesn't

Most ClickHouse vs DuckDB comparisons were written before Quack and frame the choice as "in-process vs server". Quack turns DuckDB into a server you can connect to from other DuckDB clients ([duckdb.org/quack](https://duckdb.org/quack/)), and DuckDB lists its use cases as concurrent read-write access to one database, moving computation close to data on a server, and querying a powerful server from a laptop.

Three things have not changed, according to DuckDB's own [Quack FAQ](https://duckdb.org/quack/faq), read on 14 November 2026:

1. It is beta and "not yet" production-ready, and the protocol is not yet stable.
2. It does not support distributed query processing, so one server is the ceiling.
3. MotherDuck, the managed DuckDB service, uses its own protocol rather than Quack.

So for a team choosing a production database for a multi-user product today, the practical comparison is still ClickHouse against DuckDB on a single machine. Quack is worth watching for internal tools where one shared DuckDB server is enough.

## Where chDB fits

chDB is to ClickHouse what DuckDB is to an analytical server: the engine inside your process. That makes a third pattern possible, which most comparisons miss: use the in-process engine for tests, notebooks and CI, and the server in production, with the same SQL.

With DuckDB in tests and ClickHouse in production, you maintain two SQL dialects and the results can differ. With chDB in tests and ClickHouse in production, the SQL is the same, and so is the function library. The [chDB Python tutorial](/blog/chdb-python-tutorial) shows this end to end on chDB 4.4.0 and a ClickHouse 26.6 server, with identical results.

## The same metrics on chDB and on a ClickHouse server

If you define metrics once in code, the engine becomes a setting. With hypequery's Python SDK, a dataset declares dimensions and measures over a table, and the same dataset runs on chDB or a ClickHouse server by swapping the executor:

```python
from hypequery.datasets import dataset, dimension, measure

orders = dataset(
    "orders",
    source="orders",
    time_key="created_at",
    dimensions={
        "country": dimension.string(),
        "status": dimension.string(),
    },
    measures={
        "revenue": measure.sum("amount"),
        "orderCount": measure.count("id"),
    },
)
```

Choosing the engine is one function:

```python
import os

from hypequery.execution import (
    ClickHouseConnection,
    create_chdb_executor,
    create_clickhouse_executor,
)


def make_executor():
    if os.environ.get("CLICKHOUSE_URL"):
        return create_clickhouse_executor(ClickHouseConnection.from_env())
    return create_chdb_executor("/tmp/shop.chdb")
```

These snippets come from the [chDB tutorial](/blog/chdb-python-tutorial#how-do-you-run-the-same-metrics-on-chdb-and-on-a-clickhouse-server), which has the full, tested script and its output on both engines. For the wider Python picture, see [ClickHouse in Python](/clickhouse-python), and for the server-side choice between Postgres and ClickHouse, see [ClickHouse vs Postgres for app analytics](/guides/clickhouse-vs-postgres-app-analytics).

## Sources

All read on 14 November 2026.

- DuckDB: [homepage](https://duckdb.org/), [Quack](https://duckdb.org/quack/), [Quack FAQ](https://duckdb.org/quack/faq), [release calendar](https://duckdb.org/release_calendar) (DuckDB 2.0.0 released 21 October 2026), [SQL dialect](https://duckdb.org/docs/stable/sql/dialect/overview)
- ClickHouse: [chDB docs](https://clickhouse.com/docs/chdb), [chDB joins ClickHouse](https://clickhouse.com/blog/chdb-joins-clickhouse-family)
