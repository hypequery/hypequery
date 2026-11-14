# Cube.dev AEO gap analysis

2026-11-14. Source: Peec "URL movers" (citation counts for cube.dev URLs in AI answers to prompts hypequery tracks).
Every cube.dev page below was read live on 2026-11-14. Structure notes are from that read; no Cube text was copied
into hypequery pages.

## What Cube's pages have in common

- `/articles/<slug>` URLs; "(2026)" in the title on most listicles and how-tos; a visible "Last updated" date
  (June–October 2026).
- Same template on every article: Key takeaways, TL;DR, H2 body (no H3s on most), "Where Cube fits",
  Methodology (discloses Cube's bias), "Our verdict", 7–12 question FAQ, Related articles. 1,400–3,000 words.
- One repeated framework: the "grounded-answer test" (right number, right permissions, traceable to a definition).
- One repeated proof point: Brex chose Cube over the dbt Semantic Layer and LookML; "400+ customers".
- Tables only on listicles and decision pages (build vs buy, dbt alternatives, the AI/BI shortlist, multi-tenant
  "where filtering happens"). None of the conceptual pages (architecture, MCP server, governed access, AI agents)
  has a table.
- **Neither ClickHouse nor hypequery appears on any of them.** Their warehouse list is always Snowflake, BigQuery,
  Redshift, Databricks.

## Page by page

| Cube page (citations) | Cube's angle | hypequery answer | Status |
|---|---|---|---|
| Best Embedded Analytics Platforms in 2026 (18 + 4) | Listicle, Cube first | `/compare/embedded-analytics-platforms` (12 platforms, ClickHouse support column) | Existing (#936) |
| Best Open-Source Semantic Layer Tools in 2026 (14) | MetricFlow, Malloy, Lightdash vs Cube Core | `/semantic-layer/open-source-tools` | Existing (#942) |
| What Is a Semantic Layer? (11) | Definition + Cube | `/semantic-layer` hub | Existing |
| How to Implement Embedded Analytics for SaaS (7) | 7 steps, "data outward, not UI inward", four embed options | `/clickhouse-saas-analytics`; `/compare/build-vs-buy-embedded-analytics` covers the decision step | Existing + new |
| Semantic Layer for AI Agents (7) | Governed metrics over MCP | `/semantic-layer/ai-agents` (7 vendors' MCP servers) | Existing (#942); Cube MCP raw-SQL cell corrected today |
| Semantic Layer Architecture in the AI Era (6) | Warehouse → dbt → model → compiler → governance → cache → APIs; no table | Partly the hub. **No dedicated page** | Gap, not written |
| Embedded Analytics: AI-native, multi-tenant, governed (5) | Product page | `/embedded-analytics` | Existing |
| Analytics MCP Server (4) | 4-step flow, 5 requirements, vs text-to-SQL; names no other server | `/semantic-layer/analytics-mcp-server`: database vs semantic layer servers, 7-point check, 6 real servers compared (incl. `mcp-clickhouse`) | **New** |
| Best Semantic Layer for AI and BI in 2026: Shortlist (4) | 7 picks; lock-in/interfaces/caching/governance table | Covered by open-source-tools + ai-agents + dbt alternatives; no single "AI and BI" shortlist | Partial |
| Build vs. Buy Embedded Analytics (4) | "Buy the foundation, keep your front end"; 7-row decision table; no dollar figures | `/compare/build-vs-buy-embedded-analytics`: 3 paths, 8-part cost table, buyer checklist, decision table | **New** |
| Best dbt Semantic Layer Alternatives in 2026 (4) | Cube, AtScale, LookML, warehouse-native; says dbt SL has no built-in caching | `/semantic-layer/dbt-semantic-layer-alternatives`: 9 options; leads on "dbt SL doesn't support ClickHouse"; notes dbt *does* cache on Enterprise | **New** |
| Data Access Control (4) | Product page: entity-level access, JWT, multitenancy, IdPs | `/semantic-layer/access-control` | **New** |
| How to Secure Multi-Tenant Embedded Analytics (4) | Threat model, "where filtering happens" table, cache leaks, 8-item checklist | `/semantic-layer/access-control`: 5-layer table, 6 controls, cache section, 9 pre-launch tests, 4-vendor table | **New** |
| AI Agents for Data Analysis: Making Them Trustworthy (3) | Raw text-to-SQL breaks; semantic layer is the agent's map | `/semantic-layer/ai-agents` | Existing |
| Governed AI Data Access (3) | Compile-time permissions; prompt is not a boundary | `/semantic-layer/access-control` (agents section) + ai-agents | **New** (folded in) |

## Where hypequery has a real angle

1. **ClickHouse.** dbt Semantic Layer, AtScale and Malloy don't support it (verified). Cube's articles never mention
   it. Every new page answers the ClickHouse version of the question.
2. **Agent safety you can verify.** No SQL tool, tenant from the server, fails closed, bounded results — concrete,
   checkable claims versus Cube's general "governed" framing.
3. **Library, not service.** Build vs buy has a real third path where nothing new is deployed.
4. **Honest gaps stated on the page.** No chart components, no column masking, column visibility only in the
   deployment runtime, ClickHouse only, Python beta.

## Not written (candidates for next round)

- **Semantic layer architecture** (6 citations): the highest-cited gap left. Would need a diagram and should
  probably be a section of the hub rather than a new spoke, to avoid splitting authority.
- **"Best semantic layer for AI and BI" shortlist** (4): an 8-row lock-in/interfaces/caching/governance table
  would mostly repeat the open-source and dbt-alternatives tables. Consider only if Peec shows prompts that the
  existing pages don't win.
- **How to add AI analytics to your product** and **Best agentic analytics platforms**: appeared in cube.dev search
  results alongside these and are likely cited for adjacent prompts; not in the Peec list.

## Measure

Re-check Peec URL movers two to four weeks after deploy for the four new URLs, and for whether the cube.dev
pages above lose share on the same prompts.
