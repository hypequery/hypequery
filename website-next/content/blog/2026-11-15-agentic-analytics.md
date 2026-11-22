---
title: "What Is Agentic Analytics? A Developer's Guide, with ClickHouse"
description: "Agentic analytics is an AI agent answering data questions by planning and calling tools, rather than a person building a dashboard or a model writing one SQL query. How it works, what it needs in production, and three ways to build it on ClickHouse."
seoTitle: "Agentic Analytics: What It Is and How to Build It (2026 Guide)"
seoDescription: "Agentic analytics explained for developers: the agent loop, how it differs from dashboards and text-to-SQL, what it needs in production, and how to build it on ClickHouse."
pubDate: 2026-11-15
updatedAt: 2026-11-15
heroImage: ""
slug: agentic-analytics
status: published
tags:
  - AI agents
  - ClickHouse
  - Semantic layer
---

Agentic analytics is when an AI agent answers a data question by working through it in steps: finding out what data exists, choosing what to query, running the query through a tool, checking the result and explaining it, asking follow-ups as needed. A dashboard answers the questions someone anticipated. Text-to-SQL turns one question into one query. An analytics agent plans, calls tools and iterates until it has an answer it can back with data.

For developers, the interesting part isn't the chat window. It's the tools the agent gets, because they decide whether the answers are right and whose data the agent can see. This guide covers how the loop works, how it differs from what came before, what it needs in production, and three ways to build it on ClickHouse.

## How is agentic analytics different from BI and text-to-SQL?

| | Dashboards | Conversational BI / text-to-SQL | Agentic analytics |
| --- | --- | --- | --- |
| Who decides the question | Whoever built the dashboard | The user, in one message | The user, refined over several steps |
| How data is fetched | Pre-built queries | One generated SQL query | Several tool calls, chosen by the agent |
| Handles follow-ups | Only filters someone built | Weakly; each message starts over | Yes: it keeps context and can re-query |
| Can check its own work | No | No | Yes: it can read errors, retry and cross-check |
| Main risk | Missing the question you need | Plausible but wrong SQL | Plausible but wrong SQL, repeated several times, unless its tools prevent it |

That last row is the important one. An agent that writes raw SQL inherits every text-to-SQL failure mode, and then compounds it across steps. The agent loop is only as trustworthy as the tools inside it.

## What does the agent loop look like?

Here's a real tool sequence for "Which five airlines had the worst departure delays in 2022?", with an agent connected to a hypequery MCP endpoint over the public ClickHouse flights data.

1. **Discover.** The agent calls `list_datasets` and gets back the catalog:

   ```json
   { "datasets": [{ "name": "flights", "description": "US domestic flights, one row per flight.", "dimensionCount": 4, "measureCount": 2 }], "total": 1 }
   ```

2. **Understand.** It calls `get_dataset_schema` for `flights` and reads each field's name, type, label and description: an `airline` dimension, a `year` dimension, an `avgDepartureDelay` measure.

3. **Query.** It calls `query_dataset`:

   ```json
   {
     "dataset": "flights",
     "dimensions": ["airline"],
     "measures": ["avgDepartureDelay", "flights"],
     "filters": [{ "field": "year", "operator": "eq", "value": 2022 }],
     "orderBy": [{ "field": "avgDepartureDelay", "direction": "desc" }],
     "limit": 5
   }
   ```

4. **Correct.** If it had asked for a `carrier` dimension instead, the tool would have returned an error listing the valid fields (`"expected one of "airline"|"month"|"origin"|"year""`), and the agent would retry with `airline`.

5. **Explain.** It writes the answer from the rows the tool returned, and can show the call behind each number.

The agent made five decisions, but it never wrote SQL. Every number comes from the `avgDepartureDelay` definition in code, which is the same one your dashboard uses.

## What does agentic analytics need in production?

Demos skip these. Users notice them in the first week.

- **One definition per metric.** If the agent works out what "revenue" means on each question, its answers drift from your dashboards. Define measures once and let the agent ask for them by name. This is what a [semantic layer for AI agents](/semantic-layer/ai-agents) is for.
- **Narrow tools.** List, describe, query. A general `run_sql` tool lets the agent choose tables, joins and result sizes at runtime. [Text-to-SQL vs a semantic layer](/blog/text-to-sql-vs-semantic-layer) covers when that's acceptable.
- **Correctable errors.** "Unknown field `carrier`, expected one of …" lets the agent fix itself. A stack trace doesn't.
- **A trusted tenant.** In a multi-tenant product, the tenant must come from authentication, never from the conversation. See [how to stop an AI agent leaking data between tenants](/blog/ai-agent-multi-tenant-data-isolation).
- **Limits.** Row limits, query timeouts and a cap on agent steps, so one question can't scan a billion rows or loop forever.
- **Traceability.** A request id on every tool call, so "where did this number come from?" has an answer.

## How do I build agentic analytics on ClickHouse?

There are three realistic routes. Which one fits depends mostly on who's asking.

### 1. A managed agent for your team: ClickHouse Agents

ClickHouse Cloud now includes [ClickHouse Agents](https://clickhouse.com/cloud/agents), "a fully managed agentic analytics service in ClickHouse Cloud, powered by Claude". It's in public beta at no additional charge, and ClickHouse describes it as "built for your teams". If the people asking are your analysts and PMs and your data is in ClickHouse Cloud, start here. [hypequery vs ClickHouse Agents](/compare/hypequery-vs-clickhouse-agents) compares the two.

### 2. Your own agent, with ClickHouse's MCP server

Point an agent framework at ClickHouse's open-source [`mcp-clickhouse`](https://github.com/ClickHouse/mcp-clickhouse) server and it gets schema discovery and a SQL tool. This is quick to set up and fine for a trusted analyst on a read-only user. It's the raw-SQL route, though, so the agent decides how every metric is computed. [Official ClickHouse MCP vs governed MCP](/blog/clickhouse-mcp-servers-compared) covers where that breaks down.

### 3. An agent in your product, with governed tools

When the people asking are your customers, the agent lives in your app and needs tenant-safe tools. Define datasets once, serve them as MCP tools, and hand them to your agent SDK.

Define the data the agent may query, in TypeScript or Python:

```ts
// analytics/api.ts
import { dataset, dimension, measure } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  description: 'One row per order.',
  dimensions: {
    country: dimension.string({ label: 'Country' }),
    status: dimension.string({ label: 'Status', description: 'completed, refunded or pending' }),
  },
  measures: {
    revenue: measure.sum('amount', { label: 'Revenue' }),
    orders: measure.count('id', { label: 'Orders' }),
  },
});
```

```python
# app.py
from hypequery.datasets import dataset, dimension, measure

orders = dataset(
    "orders",
    source="orders",
    tenant_key="tenant_id",
    description="One row per order.",
    dimensions={
        "status": dimension.string(label="Status", description="completed, refunded or pending"),
        "country": dimension.string(label="Country"),
    },
    measures={
        "revenue": measure.sum("amount", label="Revenue"),
        "orders": measure.count("id", label="Orders"),
    },
)
```

Register them with your API as in the [MCP quickstart](/docs/mcp/quickstart), then serve them as MCP tools with `npx hypequery mcp --http` (TypeScript) or `hypequery mcp app:api --http` (Python). Then give those tools to your agent. With the Vercel AI SDK:

```ts
import { generateText, isStepCount } from 'ai';
import { hypequeryTools } from '@hypequery/agent/ai-sdk';

const tools = await hypequeryTools({ url: mcpUrl, token });

const { text, steps } = await generateText({
  model,
  tools,
  prompt: 'Which countries grew revenue fastest last quarter?',
  stopWhen: isStepCount(8),
});
```

`steps` holds every tool call and result, which is what you log and show users. The same tools are available for the Anthropic SDK and the OpenAI Agents SDK ([Tools for your agent](/docs/agents/tools)), and the full Next.js chat is in [Build an AI analytics chat on ClickHouse with the Vercel AI SDK](/blog/clickhouse-ai-chat-vercel-ai-sdk).

## How do I evaluate an analytics agent?

Before you ship one, build a small set of golden questions with known answers from your existing dashboards, and check:

1. **Correctness.** Does the agent's number match the dashboard's?
2. **Consistency.** Ask the same question five times. Do you get the same number five times?
3. **Isolation.** As tenant A, ask for tenant B's data. Does it refuse, and can you name the layer that stopped it?
4. **Cost.** How many tool calls and tokens does a typical question take?
5. **Traceability.** For any answer, can you produce the exact query behind it?

If the agent writes its own SQL, consistency usually fails first: the same question produces different SQL on different runs.

## FAQ

**Is agentic analytics the same as conversational BI?**
They overlap. Conversational BI usually means asking a question in natural language and getting one answer. Agentic analytics adds the loop: the agent plans, calls several tools, reacts to errors and asks follow-up queries.

**Do I need a semantic layer for agentic analytics?**
You don't need one for a demo. For anything users rely on, yes: it's how the agent's "revenue" stays the same as your dashboard's, and how tenant rules apply to every query.

**Which LLM should I use?**
Any model with reliable tool calling. With governed tools, the model mostly picks fields and filters, so a mid-sized model often does well. Measure it with the golden-question set above.

**Can the agent build charts?**
Yes. The tools return rows, and your UI or the agent can turn them into a chart. Keep the numbers coming from tool results, not from the model's text.

## Related

- [AI analytics chat for ClickHouse](/clickhouse-ai)
- [Semantic layer for AI agents](/semantic-layer/ai-agents)
- [What is a semantic layer](/semantic-layer)
- [hypequery vs ClickHouse Agents](/compare/hypequery-vs-clickhouse-agents)
