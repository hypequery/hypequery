# New-page briefs from the November 2026 SEO pass

PR #963 fixed what existing pages could fix. These three clusters have real demand that no existing page targets, so they need new pages, which is an owner decision. Volumes are US monthly searches from OpenSEO/DataForSEO, and SERPs were checked live on 2026-11-14. "KD" is keyword difficulty, 0–100.

| Cluster | Main queries (volume, KD) | Total | hypequery today |
|---|---|---|---|
| ClickHouse pricing | clickhouse pricing (390, 20), clickhouse cloud pricing (320, 12), clickhouse cloud pricing calculator (40, 0) | ~750 | Not in the top 30. Prices sit inside the managed services post and the Tinybird comparison. |
| Agentic analytics | agentic analytics (320, 4), analytics agent (210, 8), what is agentic analytics (140, 2), agentic bi (70, 14), agentic analytics platform (40, 11) | ~780 | Not in the top 20. Cube is #12 with a listicle. |
| ClickHouse vs DuckDB | duckdb vs clickhouse (170, 0), clickhouse vs duckdb (140, 0), chdb vs duckdb (20) | ~330 | Not in the top 30. The chDB tutorial has a short chDB vs DuckDB section. |

## 1. ClickHouse Cloud pricing (`/clickhouse-cloud-pricing`): draft ready

A draft of this page, with every ClickHouse figure re-checked on clickhouse.com/pricing on 2026-11-14, is on branch `seo/clickhouse-cloud-pricing-draft` (no PR). It merges cleanly with `main` and with this PR.

**Intent:** "what will ClickHouse cost me". Page one has clickhouse.com/pricing, then thin aggregator pages (techbible, queryfanout, c3x, jusdb, selfhost.dev). A dated, worked-example page can rank.

**Already verified on the site (8 Nov 2026), reusable as is:**
- Compute is billed per minute in units of 8 GiB RAM and 2 vCPUs. On AWS us-east-1: $0.2181 per unit-hour on Basic, $0.2985 on Scale, $0.3903 on Enterprise. Storage is $25.30 per TB-month compressed. Idle services scale to zero.
- The smallest Basic service running all month is about $160 of compute. Trials get $300 of credits for 30 days.
- Basic tops out at 1 TB of storage and 8–12 GiB of memory in one zone. BYOC needs a committed contract.
- The Tinybird, Aiven and Altinity entry prices are in `managed-clickhouse-services-compared` and `compare/clickhouse-cloud-vs-tinybird`.

**Page shape:** an answer first ("Basic from ~$160/month always-on, or less if it idles"), a price table by tier, three worked monthly estimates (dev, small SaaS, always-on Scale), a "how to cut it" section (idle scaling, Basic vs Scale), comparisons against Tinybird, Aiven and self-hosted, and FAQPage data. Date every number and link the pricing page.

**Links in:** the managed services post's ClickHouse Cloud section, the Tinybird comparison, `/tinybird-alternative` and `/clickhouse`.

## 2. Agentic analytics (`/semantic-layer/agentic-analytics`): draft ready

A draft is on branch `seo/agentic-analytics-draft` (no PR). It merges cleanly with `main` and with this PR. It makes no new vendor claims; the vendor-by-vendor table stays on `/semantic-layer/ai-agents`, which links to it. Add the measured results from `semantic-layer-for-agents-clickhouse` once that post is published.

**Intent:** a definition plus vendor evaluation. Page one has Tellius, Databricks, AtScale, Sigma and Gartner, all enterprise BI vendors. None takes the code-first or ClickHouse angle, which is hypequery's.

**Angle:** what agentic analytics is, why agents need governed metrics rather than raw SQL (reuse the measured results from `semantic-layer-for-agents-clickhouse`), the build options (BI-vendor agents, a semantic layer plus MCP, raw text-to-SQL), and a checklist. Link `/semantic-layer/ai-agents` (the "AI semantic layer" page), `/semantic-layer/analytics-mcp-server`, `/clickhouse-mcp` and the MCP comparison post.

**Watch out:** don't duplicate `/semantic-layer/ai-agents`. That page is "how semantic layers expose metrics to agents"; this one is "what agentic analytics is and how to build it". Cross-link the two.

## 3. ClickHouse vs DuckDB: draft ready as `/blog/clickhouse-vs-duckdb`

A draft is on branch `seo/clickhouse-vs-duckdb-draft` (no PR), as a blog post rather than a `/compare` page because the compare template is built for hypequery-vs-X pages. The Quack facts were checked on duckdb.org on 2026-11-14. It merges cleanly with `main`, this PR and the agentic analytics draft.

**Intent:** choosing an analytical engine. Page one is generic (InfluxData, RisingWave, Airbyte, Elest.io, Kanopy) with old benchmarks.

**Angle:** a scale and deployment decision (one process vs a shared server), plus chDB as the "ClickHouse inside your process" answer that most comparisons miss. The chDB tutorial has measured chDB 4.4.0 results to reuse. Include a short "same metrics on chDB and on a ClickHouse server" example, since hypequery runs on both.

**Links in:** the chDB tutorial (rename its section to point here), `/clickhouse-python`, and `/guides/clickhouse-vs-postgres-app-analytics`.

**Check first:** DuckDB's site now describes the Quack protocol (introduced at AI Council 2026) as turning DuckDB into a client-server database (duckdb.org/quack). Most ranking comparisons predate it and frame the choice as in-process vs server. Read the Quack docs before writing, because that framing is now incomplete.

## After the 2026-12-01 recheck

- `/compare/clickhouse-cloud-vs-tinybird` is titled "Is Tinybird More Expensive Than ClickHouse Cloud? (2026)" (224 impressions for that question). It also ranks ~6–7 for "clickhouse vs tinybird" (140/mo, KD 0), which the title doesn't contain. If the November rewrite hasn't lifted CTR by then, try "ClickHouse Cloud vs Tinybird: Is Tinybird More Expensive? (2026)". It's left alone for now so the recheck can measure the rewrite on its own.

- "clickhouse mcp" (390/mo US, KD 15) is the biggest query near reach. On 2026-11-14 `/clickhouse-mcp` was at best position ~20 in the US. Page one is the official server's pages plus MCP directories (glama.ai, mcp.so, mcpservers.org, mcpmarket, Smithery, PyPI) and Tinybird's "quick review of different ClickHouse MCP servers". `@hypequery/mcp` 0.13.0 is already in the official MCP Registry and Glama lists the main repo. `/blog/clickhouse-mcp-servers-compared` (published 2026-11-08) had no impressions yet. If it still has none by the recheck, retitle it as a comparison, e.g. "ClickHouse MCP Servers Compared: Official, Cloud and Governed (2026)", since the ranking review pages are framed that way.

- Answers added on 2026-11-14 for "documentation"-style fan-out queries. Recheck each page's CTR for its queries in GSC:
  - PREWHERE post: "prewhere", "clickhouse prewhere" (~190 impressions/3 months, 0 clicks)
  - toStartOfInterval post: "clickhouse 20.6 tostartofinterval datetime64 ..." (~250)
  - LIMIT BY post: "clickhouse limit 1 by ... syntax" (~60)
  - quantile page: "quantileexactif documentation" (~45)
  - formatDateTime page: "%M" queries (version note)
  - pagination post (267, 0 clicks)

  Many of these queries look machine-generated ("... official docs", "... documentation"), so a lack of clicks may reflect who is searching rather than the answer.

## Not worth a page

- **"Agentic AI"** (90k, KD 58): generic intent and unwinnable.
- **"AI context layer"**: near-zero volume. Snowflake and Glean define the term.
- **"hyperquery alternative"** (17 impressions): people looking for a different product called Hyperquery.
