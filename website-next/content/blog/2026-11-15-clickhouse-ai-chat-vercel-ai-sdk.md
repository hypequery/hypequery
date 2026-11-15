---
title: "Build an AI Analytics Chat on ClickHouse with the Vercel AI SDK"
description: "A Next.js chat that answers questions about ClickHouse data with the Vercel AI SDK. The model calls typed dataset tools instead of writing SQL, and each customer only sees their own rows."
seoTitle: "ClickHouse AI Chat with the Vercel AI SDK (Next.js Tutorial)"
seoDescription: "Build a chat-with-your-data app on ClickHouse with the Vercel AI SDK, useChat and streamText. The model calls governed dataset tools, not raw SQL. Full code."
pubDate: 2026-11-15
updatedAt: 2026-11-15
heroImage: ""
slug: clickhouse-ai-chat-vercel-ai-sdk
status: published
tags:
  - AI agents
  - ClickHouse
  - TypeScript
---

To build an AI analytics chat on ClickHouse with the Vercel AI SDK, define the data the model may query as hypequery datasets, serve them as MCP tools with `npx hypequery mcp --http`, and pass `await hypequeryTools({ url, token })` from `@hypequery/agent/ai-sdk` to `streamText` in a Next.js route. The browser side is a plain `useChat` component. The model answers by calling `list_datasets`, `get_dataset_schema` and `query_dataset`, so it never writes SQL, and every number comes from one definition of each measure.

This post builds that app end to end: about 120 lines of code across four files. The code was type-checked on 2026-11-15 against `ai` 7.0.173, `@ai-sdk/react` 4.0.177, `@hypequery/cli` 1.30.0 and `@hypequery/mcp` 0.13.0. It uses the public ClickHouse playground, so you don't need your own database to follow along.

## Why not let the model write SQL against ClickHouse?

[Text-to-SQL](/blog/text-to-sql-vs-semantic-layer) is the obvious first try, and on ClickHouse it fails in specific ways. A `ReplacingMergeTree` table read without `FINAL` counts rows twice. `uniq` and `uniqExact` return different numbers for the same question. A `DateTime` column in UTC moves the day boundaries for anyone not in UTC. And in a product with many customers, nothing in a generated SQL string stops a read of another customer's rows. A prompt is not a tenant boundary.

Tool calling fixes this when the tools are narrow. Instead of an `execute_sql` tool, the model gets a semantic layer: datasets with named dimensions and measures, each defined once in code. It can only ask for fields that exist, and a wrong field name comes back as an error it can fix. [Official ClickHouse MCP vs governed MCP](/blog/clickhouse-mcp-servers-compared) compares the two approaches in detail.

## What are we building?

```text
Browser (useChat)
   │  POST /api/chat
   ▼
Next.js route: streamText({ model, tools })
   │  tools = await hypequeryTools({ url, token })
   ▼
hypequery MCP endpoint: list_datasets · get_dataset_schema · query_dataset
   │  validated, typed queries
   ▼
ClickHouse
```

The browser never sees the ClickHouse credentials or the MCP key. The route handler holds the key, and the MCP endpoint holds the database connection.

## Step 1: define what the model can query

Create a Next.js app and install the packages:

```bash
npx create-next-app@latest clickhouse-chat --ts --app
cd clickhouse-chat
npm install ai @ai-sdk/react @ai-sdk/anthropic @hypequery/agent
npm install @hypequery/clickhouse @hypequery/datasets @hypequery/serve
npm install -D @hypequery/cli
```

Then describe the data. The dataset names the table, the columns the model can group and filter by, and the measures it can ask for. The labels and descriptions are what the model reads to choose fields, so write them for a reader. Nothing outside the dataset is reachable. Save this as `analytics/api.ts`:

```typescript
// analytics/api.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import { dataset, dimension, measure } from '@hypequery/datasets';
import { initServe } from '@hypequery/serve';

const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL ?? 'https://play.clickhouse.com',
  username: process.env.CLICKHOUSE_USERNAME ?? 'play',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE ?? 'default',
  // The playground user is readonly = 1, which rejects the setting hypequery
  // normally sends to quote 64-bit integers. Remove this line for your own server.
  integerJsonEncoding: 'server-default',
});

const Flights = dataset('flights', {
  source: 'ontime',
  description: 'US domestic flights, one row per flight.',
  limits: { maxResultSize: 1000 },
  dimensions: {
    year: dimension.number({ column: 'Year', label: 'Year' }),
    month: dimension.number({ column: 'Month', label: 'Month (1-12)' }),
    airline: dimension.string({
      column: 'Reporting_Airline',
      label: 'Airline code',
      description: 'Two-letter carrier code, for example AA or DL',
    }),
    origin: dimension.string({ column: 'OriginCityName', label: 'Origin city' }),
  },
  measures: {
    flights: measure.count('Year', { label: 'Flights' }),
    avgDepartureDelay: measure.avg('DepDelay', { label: 'Average departure delay (minutes)' }),
  },
});

const { serve } = initServe({ context: () => ({ db }) });

export const api = serve({
  queryBuilder: db,
  datasets: { flights: Flights },
});
```

The playground's `ontime` table holds US domestic flights. Swap in your own table and columns when you're ready; the rest of the app doesn't change.

## Step 2: serve the datasets as MCP tools

`hypequery mcp` finds `analytics/api.ts` on its own. Add `--http` to serve it at a URL behind a key:

```bash
export HYPEQUERY_MCP_KEY=$(openssl rand -hex 32)
npx hypequery mcp --http
```

```text
hypequery MCP serving 1 dataset(s) over HTTP: flights
hypequery MCP listening on http://127.0.0.1:3333/mcp (Host: localhost, 127.0.0.1, [::1])
```

A request without the key gets `401`. Put the same key and the URL in `.env.local` for the Next.js app, with your model provider's key:

```bash
# .env.local
HYPEQUERY_MCP_URL=http://127.0.0.1:3333/mcp
HYPEQUERY_MCP_KEY=<the key you exported above>
ANTHROPIC_API_KEY=<your key>
```

## Step 3: give the AI SDK the hypequery tools

`hypequeryTools()` lists the endpoint's tools once and returns them as an AI SDK tool set. Their input schemas are the ones the server publishes, unchanged, so the model sees an enum of real field names rather than a free-form string. Save this as `app/api/chat/route.ts`:

```typescript
// app/api/chat/route.ts
import { anthropic } from '@ai-sdk/anthropic';
import { convertToModelMessages, isStepCount, streamText, type UIMessage } from 'ai';
import { hypequeryTools } from '@hypequery/agent/ai-sdk';

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // The tools the endpoint serves: list_datasets, get_dataset_schema, query_dataset, ...
  const tools = await hypequeryTools({
    url: process.env.HYPEQUERY_MCP_URL!,
    token: process.env.HYPEQUERY_MCP_KEY!,
  });

  const result = streamText({
    model: anthropic('claude-sonnet-5-5'),
    instructions:
      'You answer questions about our analytics data. Use the hypequery tools: list the datasets, ' +
      'read a dataset schema before querying it, and only report numbers a tool returned. ' +
      'If a tool returns an error, read its hint, fix the call and try again.',
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: isStepCount(8),
  });

  return result.toUIMessageStreamResponse();
}
```

Any AI SDK provider works in place of `@ai-sdk/anthropic`. `stopWhen` caps the tool loop: a typical question takes three steps (list, schema, query) plus the answer, so 8 leaves room for one or two corrections.

**On AI SDK 5 or 6:** use `system` instead of `instructions` and `stepCountIs(8)` instead of `isStepCount(8)`. `@hypequery/agent` supports `ai` 5, 6 and 7.

## Step 4: the chat UI

`useChat` posts to `/api/chat` by default and streams the answer back as message parts. Tool calls arrive as parts too, so you can show which tool ran and with what arguments. Replace `app/page.tsx`:

```tsx
// app/page.tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { getToolName, isToolUIPart } from 'ai';
import { useState } from 'react';

export default function Chat() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState('');

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      {messages.map((message) => (
        <div key={message.id} style={{ marginBottom: 16 }}>
          <strong>{message.role === 'user' ? 'You' : 'Analyst'}</strong>
          {message.parts.map((part, i) => {
            if (part.type === 'text') return <p key={i}>{part.text}</p>;
            if (isToolUIPart(part)) {
              return (
                <details key={i}>
                  <summary>
                    {getToolName(part)} · {part.state === 'output-available' ? 'done' : 'running…'}
                  </summary>
                  <pre>{JSON.stringify(part.input, null, 2)}</pre>
                </details>
              );
            }
            return null;
          })}
        </div>
      ))}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim()) return;
          sendMessage({ text: input });
          setInput('');
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Which airlines had the worst departure delays in 2022?"
          disabled={status !== 'ready'}
          style={{ width: '100%', padding: 8 }}
        />
      </form>
    </main>
  );
}
```

The `<details>` block is worth keeping in production. Users trust an answer more when they can open it and see `query_dataset` was called with `dimensions: ["airline"]` and a `year` filter.

## Step 5: ask a question

Run `npm run dev`, open `http://localhost:3000`, and ask: "Which five airlines had the highest average departure delay in 2022?"

The model works through the tools in order. `list_datasets` returns the catalog:

```json
{
  "datasets": [
    {
      "name": "flights",
      "description": "US domestic flights, one row per flight.",
      "dimensionCount": 4,
      "measureCount": 2,
      "metricCount": 0
    }
  ],
  "total": 1
}
```

`get_dataset_schema` returns each field's name, type, label and description, and then `query_dataset` runs the query:

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

hypequery turns that into one ClickHouse query and returns the rows. The model writes the answer from those rows only.

## What happens when the model picks a field that doesn't exist?

It gets an error it can act on, not a stack trace. Asking for a `carrier` dimension instead of `airline` returns this as the tool's output:

```json
{
  "error": {
    "code": "MCP_INVALID_ARGUMENTS",
    "category": "correctable_input",
    "message": "Invalid query_dataset arguments: dimensions.0: Invalid option: expected one of \"airline\"|\"month\"|\"origin\"|\"year\"",
    "retryable": false,
    "correctable": true
  }
}
```

The message lists the valid fields, so on the next step the model retries with `airline`. Failures that are yours to fix, like a refused key or an unreachable endpoint, throw `HypequeryToolsError` in the route instead of going to the model.

## How do I make it multi-tenant, so each customer only sees their data?

With one shared key, everyone who uses the chat is the same caller and sees the same data. That's fine for an internal tool. In a SaaS product, the tenant has to come from the signed-in user, never from the prompt ([why a prompt is not a tenant boundary](/blog/ai-agent-multi-tenant-data-isolation)). There are two ways to do it.

**Self-hosted.** Run `npx hypequery mcp --http` without `HYPEQUERY_MCP_KEY`, and it verifies callers with the `auth` and `tenant` you passed to `defineServe`, exactly as over REST. Give each dataset a `tenantKey`, then pass the signed-in user's token as `token` in the route. [Remote MCP over HTTP](/docs/mcp/remote#reuse-your-applications-auth) covers the rules.

**hypequery Cloud** (not live yet; [join the waitlist](/docs/cloud)). Cloud hosts the MCP endpoint, and your backend mints a short-lived token per session with a project signing key. Minting happens in your process with no network call:

```typescript
// app/api/chat/route.ts (hypequery Cloud)
import { anthropic } from '@ai-sdk/anthropic';
import { convertToModelMessages, isStepCount, streamText, type UIMessage } from 'ai';
import { mintAgentToken } from '@hypequery/agent';
import { hypequeryTools } from '@hypequery/agent/ai-sdk';
import { getSession } from '@/lib/auth'; // your auth

export async function POST(req: Request) {
  const session = await getSession(req); // who is asking, and for which customer
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Signed locally. The tenant is in the token, so no prompt can change it.
  const { token, mcpUrl } = await mintAgentToken({
    signingKey: process.env.HYPEQUERY_AGENT_KEY!,
    tenant: session.orgId,
    subject: session.userId,
    permissionSet: 'customers',
  });

  const tools = await hypequeryTools({
    url: mcpUrl,
    token,
    onResult: (r) => console.log(r.tool, r.ok ? 'ok' : r.error.code, r.requestId),
  });

  const result = streamText({
    model: anthropic('claude-sonnet-5-5'),
    instructions: "Answer questions about this customer's data using the hypequery tools.",
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: isStepCount(8),
  });

  return result.toUIMessageStreamResponse();
}
```

A prompt that asks for another customer's revenue has nothing to change: the endpoint reads the tenant from the signed token and scopes every query to it. `onResult` logs the request id of each call, which you can look up in Cloud to see the exact query behind an answer. [In-app agents](/docs/cloud/in-app-agents) covers signing keys, permission sets and rotation.

## Production checklist

- **Use a read-only ClickHouse user** for the MCP endpoint. The [read-only users guide](/docs/reference/readonly-users) recommends `readonly = 2`.
- **Keep keys on the server.** `HYPEQUERY_MCP_KEY` and `HYPEQUERY_AGENT_KEY` belong in the route handler's environment, never in a `NEXT_PUBLIC_` variable.
- **Refresh long sessions.** If your tokens expire (Cloud's last at most 15 minutes), pass a function as `token`. It's called before every request, so you can return a cached token and re-mint near expiry.
- **Cap the loop.** Keep `stopWhen` and `maxDuration` set so a confused model can't run tool calls forever.
- **Serve over HTTPS.** `hypequeryTools()` refuses a plain `http` URL anywhere but localhost, so the token is never sent unencrypted.

## FAQ

**Does this work with OpenAI, Gemini or a local model?**
Yes. `hypequeryTools()` returns standard AI SDK tools, so any provider that supports tool calling works. Change the `model` line.

**Do I need an MCP client in my app?**
No. `@hypequery/agent` talks to the MCP endpoint for you and hands the AI SDK ordinary tools. The same package also has adapters for the Anthropic SDK and the OpenAI Agents SDK; see [Tools for your agent](/docs/agents/tools).

**Does the model ever see SQL?**
No. Tool results carry rows and metadata. The generated SQL is left out unless you turn on `includeSql` for debugging.

**Can I use the same datasets in dashboards and APIs?**
Yes. The datasets in `analytics/api.ts` are the same ones you serve over REST or query from React, so the chat and your dashboards report the same revenue. See [the ClickHouse semantic layer](/clickhouse-semantic-layer).

## Next steps

- [Vercel AI SDK docs page](/docs/agents/ai-sdk): every option `hypequeryTools()` accepts.
- [MCP tools reference](/docs/mcp/tools): the arguments, operators and error codes the model sees.
- [AI analytics chat for ClickHouse](/clickhouse-ai): how the pieces fit for in-product AI.
- [What is agentic analytics?](/blog/agentic-analytics): the pattern behind this app, and how to evaluate it.
- [hypequery vs ClickHouse Agents](/compare/hypequery-vs-clickhouse-agents): when ClickHouse's managed agent is the better fit.
