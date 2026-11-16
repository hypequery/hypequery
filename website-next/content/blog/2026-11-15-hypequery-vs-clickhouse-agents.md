---
title: "hypequery vs ClickHouse Agents: Your Team's Analyst or Your Product's?"
description: "ClickHouse Agents is a managed chat and agent builder for your own team, in ClickHouse Cloud. hypequery gives the agent inside your product governed, tenant-scoped ClickHouse tools. What each does, where they overlap, and when to use both."
seoTitle: "ClickHouse Agents vs hypequery: Internal vs In-Product AI (2026)"
seoDescription: "ClickHouse Agents is a managed, Claude-powered chat for your team in ClickHouse Cloud (public beta). hypequery gives your product's agent tenant-safe ClickHouse tools. Compared."
pubDate: 2026-11-15
updatedAt: 2026-11-15
heroImage: ""
slug: hypequery-vs-clickhouse-agents
status: published
tags:
  - AI agents
  - ClickHouse
---

**Short answer:** use ClickHouse Agents when the people asking questions are your own team and your data is in ClickHouse Cloud: you get a managed chat, a no-code agent builder and Claude models with nothing to run. Use hypequery when the people asking are your customers, inside your product: it gives the agent you ship governed, tenant-scoped tools over your ClickHouse data, in TypeScript or Python. They answer different questions, and plenty of teams will want both.

ClickHouse itself draws the same line. Its product page says ClickHouse Agents is "built for your teams", and for AI inside your own product it suggests to "use ClickHouse as the real-time data layer under your own agent stack". hypequery is a governed layer for that stack.

Every claim about ClickHouse Agents below was checked on ClickHouse's own pages on November 15, 2026. It's in public beta, so check them again before you decide.

## What is ClickHouse Agents?

ClickHouse announced Agents in June 2026 as "a fully managed agentic analytics service in ClickHouse Cloud, powered by Claude" ([announcement](https://clickhouse.com/blog/clickhouse-agents-beta)). From the announcement, the [product page](https://clickhouse.com/cloud/agents) and the [docs](https://clickhouse.com/docs/products/cloud/features/ai-ml/agents):

- **A chat over live data.** People ask questions in natural language, and the chat can "generate SQL and visualizations".
- **A no-code agent builder** for instructions, skills, context files and MCP tool access, governed by Cloud RBAC.
- **A sandboxed code interpreter** for Bash, Python and JavaScript, plus memories, shareable artifacts and subagents.
- **Models:** Claude Sonnet and Haiku are pre-configured as the default with no API keys, and other models can be configured per agent.
- **Security:** SSO, sharing and access permissions, and encrypted message storage.
- **Availability:** public beta for all ClickHouse Cloud customers "at no additional charge". The product page says "Pricing will be available soon".
- **What's next:** "An Agent API for programmatic access to the agents built in ClickHouse Agents" is listed as a future plan.

ClickHouse also offers a self-hosted path: its product page points to an [Agentic Data Stack](https://github.com/ClickHouse/agentic-data-stack) repository for teams that want "maximum runtime control".

## What is hypequery?

hypequery is a set of open-source (Apache 2.0) libraries for TypeScript and Python. You define datasets over your ClickHouse tables: the dimensions an agent can group and filter by, the measures it can ask for, and the column that holds the tenant. hypequery then serves them as MCP tools (`list_datasets`, `get_dataset_schema`, `query_dataset`), and `@hypequery/agent` hands those tools to the agent SDK you already use:

```ts
import { streamText } from 'ai';
import { hypequeryTools } from '@hypequery/agent/ai-sdk';

const tools = await hypequeryTools({ url: mcpUrl, token });
const result = streamText({ model, tools, messages });
```

The model never writes SQL. It asks for `revenue` by `country`, and hypequery builds the ClickHouse query from the definition in your repo, with the signed-in customer's tenant applied server-side. [Build an AI analytics chat on ClickHouse with the Vercel AI SDK](/blog/clickhouse-ai-chat-vercel-ai-sdk) walks through a whole app.

## How do they compare?

| | hypequery | ClickHouse Agents |
| --- | --- | --- |
| Who asks the questions | Your customers, inside your product | Your own team |
| What you get | Libraries and an MCP server; you bring the agent and UI | A finished chat, agent builder and runtime |
| Where it runs | Your backend, against ClickHouse Cloud, self-hosted ClickHouse or chDB | ClickHouse Cloud only |
| How the agent reaches data | Named datasets and measures; no SQL tool | Generates SQL, grounded by skills and context you add |
| Access control | One customer per conversation, from a signed token or your API auth | Governed by Cloud RBAC, with SSO and sharing permissions |
| Models | Any model your agent SDK supports | Claude Sonnet and Haiku by default; others per agent |
| Status | Released (Apache 2.0); hypequery Cloud on a waitlist | Public beta |
| Price | Free and open source | No additional charge during the beta; pricing "available soon" |

## The question that decides it: who is asking?

**Your team.** An analyst, a PM or a support engineer wants to ask "what did EU revenue do last week?" without writing SQL. ClickHouse Agents is designed for exactly this. Access is governed by the Cloud RBAC you already use, the models are included, and there's nothing to build. hypequery can serve these users too, through Claude Code, Cursor or any MCP client, but you'd be building what ClickHouse Agents gives you ready-made.

**Your customers.** A user of your SaaS product wants to ask "which of my warehouses had the most late shipments?" Now the requirements change:

- The chat has to live in **your** UI, behind **your** login.
- Each user must only ever see **their own customer's** rows, and that can't depend on the model following instructions.
- "Late shipment" has to mean the same thing in the chat as on the dashboard next to it.
- You need an API, today, to call from your backend.

That's the case hypequery is built for. The tenant comes from a token your backend signs, or from your existing API auth, and every query is scoped to it before it reaches ClickHouse. A prompt asking for another customer's data has no field to change. [A prompt is not a tenant boundary](/blog/ai-agent-multi-tenant-data-isolation) goes into why that matters.

## Can you use both?

Yes, and it's a sensible setup. ClickHouse Agents can attach MCP servers, so you can point an internal agent at a hypequery MCP endpoint. Your team's agent and your customers' agent then query the same governed datasets, and "revenue" means the same thing in both.

## Which should you pick?

- **Internal analytics on ClickHouse Cloud, nothing to build:** ClickHouse Agents.
- **An analytics chat or agent inside your product, for your customers:** hypequery, with the agent SDK you already use.
- **Self-hosted ClickHouse, or you can't send data to a managed agent runtime:** hypequery in your backend, or ClickHouse's self-hosted stack for internal use.
- **Both audiences:** both, sharing one set of dataset definitions through MCP.

## Related

- [AI analytics chat for ClickHouse](/clickhouse-ai): the in-product path, end to end
- [Official ClickHouse MCP vs governed MCP](/blog/clickhouse-mcp-servers-compared): ClickHouse's raw SQL MCP servers compared with a governed one
- [What is agentic analytics?](/blog/agentic-analytics): the pattern behind both products
