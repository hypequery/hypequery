---
title: "Text-to-SQL vs a Semantic Layer: When NL2SQL Agents Work, and When They Don't"
description: "Text-to-SQL (NL2SQL) lets a model write the query. A semantic layer lets it ask for named metrics. How each answers the same question, where SQL agents go wrong, where they're the right tool, and how to combine the two."
seoTitle: "Text-to-SQL vs Semantic Layer: NL2SQL and SQL Agents Compared"
seoDescription: "Text-to-SQL and SQL agents generate queries; a semantic layer serves named metrics. Where NL2SQL fails in production, when it's fine, and a hybrid that works."
pubDate: 2026-11-15
updatedAt: 2026-11-15
heroImage: ""
slug: text-to-sql-vs-semantic-layer
status: published
tags:
  - AI agents
  - Semantic layer
  - ClickHouse
---

Text-to-SQL (also called NL2SQL) has a language model turn a question into a SQL query, which then runs against your database. A semantic layer turns the question into a request for named metrics and dimensions ("revenue by country, last quarter"), and generates the SQL from definitions you wrote once. Text-to-SQL can answer anything the schema allows, and is wrong in ways that are hard to spot. A semantic layer only answers what you've modelled, and answers it the same way every time.

Most production systems that work end up combining them: a semantic layer for the metrics people rely on, and SQL for trusted analysts exploring outside them. This guide shows how each approach handles the same question, where SQL agents go wrong, when text-to-SQL is the right tool, and how to combine the two.

## What's the difference between text-to-SQL, a SQL agent and a semantic layer?

- **Text-to-SQL / NL2SQL:** one question in, one SQL query out. The model sees the schema (tables, columns, perhaps sample rows) and writes the query.
- **SQL agent (text-to-SQL agent):** text-to-SQL in a loop. The agent has tools such as `list_tables`, `describe_table` and `run_query`, so it can explore the schema, read errors and retry. It's more capable than single-shot text-to-SQL, but it's still the model deciding how every number is computed.
- **Semantic layer:** a set of named business definitions (dimensions, measures, the rules that make them correct) that sits between the model and the database. The model picks from the definitions, and the layer writes the SQL.

## How does each one answer the same question?

Take "What was revenue by country last quarter?" against an `orders` table.

**Text-to-SQL** asks the model for SQL:

```sql
SELECT country, sum(amount) AS revenue
FROM orders
WHERE created_at >= '2026-07-01' AND created_at < '2026-10-01'
GROUP BY country
ORDER BY revenue DESC
```

That looks right. Whether it is depends on things the model can't see in the schema. Should refunded orders count? Is `amount` before or after tax? Is `created_at` in UTC, and which timezone's quarter did you mean? Does `orders` hold duplicate versions of a row until a background merge runs?

**A semantic layer** gets a structured request instead:

```json
{
  "dataset": "orders",
  "dimensions": ["country"],
  "measures": ["revenue"],
  "filters": [
    { "field": "createdAt", "operator": "gte", "value": "2026-07-01" },
    { "field": "createdAt", "operator": "lt", "value": "2026-10-01" }
  ]
}
```

`revenue` was defined once, in code, by someone who knew the answers to those questions. Here's that definition and query with [hypequery](/clickhouse-semantic-layer), in TypeScript and Python:

```ts
import { createDatasetClient, dataset, dimension, measure } from '@hypequery/datasets';

const analytics = createDatasetClient({ queryBuilder: db });

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    country: dimension.string({ label: 'Country' }),
    createdAt: dimension.timestamp({ column: 'created_at', label: 'Created at' }),
  },
  measures: {
    revenue: measure.sum('amount', { label: 'Revenue', description: 'Completed orders, before tax' }),
  },
});

await analytics.execute(Orders, { dimensions: ['country'], measures: ['revenue'] });
```

```python
from hypequery.datasets import DatasetQuery, dataset, dimension, measure

orders = dataset(
    "orders",
    source="orders",
    dimensions={
        "country": dimension.string(label="Country"),
        "createdAt": dimension.timestamp(column="created_at", label="Created at"),
    },
    measures={"revenue": measure.sum("amount", label="Revenue", description="Completed orders, before tax")},
)

client.execute(orders, DatasetQuery(dimensions=("country",), measures=("revenue",)))
```

Ask the same question tomorrow, or phrase it differently, and the request, the SQL and the number stay the same.

## Where does text-to-SQL go wrong?

The failures that matter aren't the SQL errors, because those surface and the agent retries. They're the queries that run, return a plausible number, and are wrong.

1. **Definitions drift.** Each answer re-derives what "revenue" or "active user" means. The model picks something reasonable each time, but not the same thing each time, so the chat and the dashboard disagree.
2. **Join fan-out.** Join `orders` to a one-to-many table such as `order_items`, then `sum(orders.amount)`, and each order is counted once per item. The SQL is valid; the total is inflated.
3. **Engine-specific semantics.** On ClickHouse, a `ReplacingMergeTree` read without `FINAL` counts unmerged duplicate rows, `uniq` is an estimate while `count(DISTINCT …)` is exact by default, and summing daily `uniqMerge` results counts a user once per day. Each is valid SQL with the wrong answer. A semantic layer handles these once, in the definition, so the model never has to remember them.
4. **Inconsistency.** The same question, asked five times, can produce five different queries. If two of them disagree, users stop trusting both.
5. **Access control.** A SQL string can read anything its database user can. In a multi-tenant product, the only thing keeping it on one customer's rows is often a line in the prompt. See [how to stop an AI agent leaking data between tenants](/blog/ai-agent-multi-tenant-data-isolation).

A SQL agent fixes the errors that throw. It doesn't fix any of these five, because none of them throw.

## When is text-to-SQL the right tool?

Honestly, often:

- **Exploration by people who read SQL.** An analyst asking "what's in this table?" or "is there anything odd about last Tuesday?" benefits from a model that can write any query, and can check the SQL it gets.
- **Questions outside your model.** A semantic layer only covers what you defined. For one-off questions about data nobody modelled, SQL is the only option.
- **Internal, single-tenant, read-only.** One trusted team, one read-only database user, nobody's billing based on the answer.
- **Bootstrapping a semantic layer.** Watching which questions people ask a SQL agent is a good way to decide which measures to define first.

## When do you need a semantic layer?

- The answer appears next to a dashboard number, or in a customer's product.
- Different people, agents or APIs must get the same number for the same question.
- Several customers share tables, and each must only ever see their own rows.
- The underlying tables need engine-specific handling (deduplication, merge functions, timezones) that you can't expect a model to remember.

## Can you combine them?

Yes, and it's usually the best design:

1. **Semantic layer first.** The agent's default tools are list, describe and query-by-name. Most questions about core metrics end here, consistently.
2. **SQL as an escape hatch for trusted users.** Analysts, or an internal agent on a read-only user with row policies, can fall back to SQL for questions outside the model. Label those answers as exploratory.
3. **Promote what gets asked.** When the same SQL question keeps coming up, define it as a measure. The model gets better without retraining.

If you do keep a SQL tool, lock it down at the database. On ClickHouse, use a dedicated user with `readonly` set, and cap `max_execution_time` and `max_result_rows`. hypequery's Python client applies those defaults to its own queries for the same reason (`readonly: 1`, a 30-second `max_execution_time`, 100,000 `max_result_rows`).

## FAQ

**Is NL2SQL the same as text-to-SQL?**
Yes. Both mean generating SQL from a natural-language question. "SQL agent" usually means the iterative, tool-using version.

**Does a semantic layer replace the LLM?**
No. The model still interprets the question, picks the dataset, dimensions, filters and time range, and explains the result. It just doesn't decide how a metric is computed.

**Can a semantic layer answer any question?**
No, only what you've modelled. That's the trade: a smaller set of questions answered the same way every time, with SQL kept for exploration.

**How do I measure which approach is more accurate?**
Write a set of questions with known answers from your dashboards, ask each several times, and check correctness and run-to-run consistency. Inconsistency is usually the first thing to break with text-to-SQL.

## Related

- [Official ClickHouse MCP vs governed MCP](/blog/clickhouse-mcp-servers-compared): a raw SQL tool and a governed one, side by side
- [What is agentic analytics?](/blog/agentic-analytics)
- [Semantic layer for AI agents](/semantic-layer/ai-agents)
- [AI analytics chat for ClickHouse](/clickhouse-ai)
