---
title: "ClickHouse vs DuckDB: Which Analytical Database Should You Use?"
description: "ClickHouse vs DuckDB in 2026: a shared analytical server versus an engine inside your process, what DuckDB's new Quack protocol changes, where chDB fits, and how to choose."
seoTitle: "ClickHouse vs DuckDB (2026): Server, In-Process, or Both"
seoDescription: "ClickHouse is a shared analytical server; DuckDB runs inside your process. What DuckDB's Quack protocol changes, where chDB fits, and how to choose."
pubDate: 2026-11-14
updatedAt: 2026-11-14
heroImage: ""
slug: clickhouse-vs-duckdb
status: published
tags:
  - ClickHouse
  - DuckDB
  - Python
---

Use ClickHouse when many users, services or dashboards query the same large, constantly updated dataset, and DuckDB when one process (a notebook, a script, a data pipeline step, a desktop app) analyses data it can reach directly. Both are column-oriented SQL engines built for analytics, and both are open source. The real difference is where the engine runs: ClickHouse is a server that clients connect to, and DuckDB is a library that runs inside your process.

That line moved in 2026. DuckDB's Quack protocol lets DuckDB run as a server too, and chDB runs the ClickHouse engine inside a Python process. This guide covers both, with every DuckDB claim checked on duckdb.org on 14 November 2026.

## Quick answers

### Is ClickHouse faster than DuckDB?

It depends on the workload, and published benchmarks rarely match yours. DuckDB on one machine is fast on data that fits that machine. ClickHouse spreads queries across a cluster of servers, which DuckDB does not do. No benchmarks were run for this guide; test both on your own data and queries.

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
| Managed service | ClickHouse Cloud and others | MotherDuck (with its own protocol, not Quack) |
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
