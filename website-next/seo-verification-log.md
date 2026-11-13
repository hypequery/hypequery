# SEO verification log: embedded analytics pages (P1)

Every claim these pages make about another company, with the page it appears on, the source it was checked
against, and the date. All sources were read live on the date shown, on the vendor's own site, docs, repository
or press pages. Search snippets and earlier knowledge were not used. If a claim isn't in this log, it isn't on
the pages.

Pages:

| # | Page | URL |
|---|---|---|
| P1 | Luzmo alternatives | /compare/luzmo-alternatives |
| P2 | hypequery vs Embeddable | /compare/hypequery-vs-embeddable |
| P3 | Cube alternatives | /cube-js-alternative |
| P4 | Best embedded analytics platforms | /compare/embedded-analytics-platforms |
| P5 | Embedded analytics pricing | /compare/embedded-analytics-pricing |
| P6 | Embedded analytics for SaaS | /clickhouse-saas-analytics |

**Re-verify quarterly.** P5 (pricing) goes stale fastest; P1, P2 and P4 repeat some of its prices.

hypequery claims (ClickHouse-only, MCP, tenant keys, scopes, no chart components, cloud waitlist with no pricing)
were checked against this repository: `packages/*`, `website-next/docs/`, and the code samples were type-checked
against the published npm packages `@hypequery/clickhouse@2.15.0`, `@hypequery/datasets@0.30.0` and
`@hypequery/serve@0.25.0` on 2026-11-12.

## Competitor claims

| Page | Claim | Source | Checked |
|---|---|---|---|
| P1, P4, P5 | Luzmo has one plan, "Embedded Everywhere", from €1,995/month, billed annually only; no smaller tier | https://www.luzmo.com/pricing | 2026-11-12 |
| P1, P5 | Luzmo includes 500 AI conversations and 100M Warp rows/month; extra Warp rows €0.25 per million; some contracts scale on MAUs | https://www.luzmo.com/pricing | 2026-11-12 |
| P1, P4, P5 | Luzmo includes white-label, self-service, AI and APIs; "Nothing is reserved for a higher plan" | https://www.luzmo.com/pricing | 2026-11-12 |
| P1 | Luzmo offers private infrastructure as a deployment option | https://www.luzmo.com/pricing | 2026-11-12 |
| P1 | Luzmo lists 19 database integrations, ClickHouse among them | https://www.luzmo.com/connect | 2026-11-12 |
| P1, P4 | Luzmo embeds via web component and React, React Native, Angular, Vue components, with a server-side embed token | https://developer.luzmo.com/guide/dashboard-embedding--embed-into-application | 2026-11-12 |
| P1, P4 | Luzmo multi-tenancy: parameter filters overridden on the embed token (parameter_overrides) or connection overrides (account_overrides); dataset-level filters recommended | https://developer.luzmo.com/guide/dashboard-embedding--handling-multi-tenant-data | 2026-11-12 |
| P1, P4 | Luzmo has an embedded dashboard editor for end users | https://developer.luzmo.com/guide/dashboard-embedding--embedded-dashboard-editor | 2026-11-12 |
| P1, P4 | Luzmo Flex is an SDK for building charts from code | https://developer.luzmo.com/guide/flex--introduction | 2026-11-12 |
| P1, P4 | Luzmo IQ gives AI answers to data questions | https://developer.luzmo.com/guide/iq--introduction | 2026-11-12 |
| P1 | Luzmo's comparison page covers Embeddable, GoodData, Metabase, Omni, Sisense and ThoughtSpot in depth | https://www.luzmo.com/compare | 2026-11-12 |
| P2, P1, P4, P5 | Embeddable publishes no price: flat monthly subscription, unlimited usage, every feature, custom quote; priced on project scope, not MAUs or query volume | https://embeddable.com/pricing | 2026-11-12 |
| P2 | Embeddable is white-labelled by default | https://embeddable.com/pricing | 2026-11-12 |
| P2, P1, P4 | Embeddable's data models use Cube's modelling language (*.cube.yml or the Data Model Editor) | https://docs.embeddable.com/data-modeling/introduction | 2026-11-12 |
| P2 | Embeddable runs a managed Cube by default; you can bring your own Cube Cloud or Cube Core | https://docs.embeddable.com/data/bring-your-own-cube ; https://docs.embeddable.com/faq | 2026-11-12 |
| P2 | Embeddable SQL-based security example (quoted verbatim on the page) | https://docs.embeddable.com/data-modeling/row-level-security/sql-based-security | 2026-11-12 |
| P2, P4 | Embeddable RLS methods: security filters, SQL-based security, access policies; SQL style repeats filters per model and recompiles per security context | https://docs.embeddable.com/data-modeling/row-level-security/access-policies | 2026-11-12 |
| P2, P1, P4 | Embeddable supports ClickHouse, Postgres, Snowflake, BigQuery, Databricks, Redshift, MySQL and others | https://docs.embeddable.com/data/credentials | 2026-11-12 |
| P2, P4 | Embeddable components are React, registered with defineComponent; dashboards built in a no-code builder or as YAML; Remarkable Pro component suite; Custom Canvas for end users | https://docs.embeddable.com/component-libraries/build-components/define-component-function ; https://docs.embeddable.com/dashboards/introduction | 2026-11-12 |
| P2, P4 | Embeddable embeds with the <em-beddable> web component, not an iframe | https://docs.embeddable.com/deployment/embedding | 2026-11-12 |
| P2, P4 | Embeddable is hosted in US and EU regions | https://docs.embeddable.com/deployment/deployment-regions | 2026-11-12 |
| P2, P4 | Embeddable AI endpoints are in beta with an example Python MCP server; AI chatbot is "Prototype" | https://docs.embeddable.com/self-serve/ai-endpoints ; https://docs.embeddable.com/self-serve/ai-chatbot | 2026-11-12 |
| P3, P4, P5 | Cube Cloud: Free $0; Starter $40 and Premium $80 per developer/month; Enterprise custom | https://cube.dev/pricing | 2026-11-12 |
| P3, P5 | Cube infrastructure billed hourly: dedicated deployment $0.60/h (Starter), $1.20/h (Premium); Cube Store workers $0.15/$0.30/h | https://cube.dev/pricing | 2026-11-12 |
| P3, P4, P5 | Cube embedded dashboards and chat need Premium; SAML SSO Enterprise-only; Premium Viewer seat $20 and Explorer $40 per user/month | https://cube.dev/pricing | 2026-11-12 |
| P3 | Cube DAX and MDX APIs need Enterprise plus the Performance M tier | https://github.com/cube-js/cube/blob/master/docs-mintlify/admin/account-billing/pricing.mdx | 2026-11-12 |
| P3, P4 | Cube Core licence: backend Apache 2.0, client MIT; about 21.2k GitHub stars | https://github.com/cube-js/cube | 2026-11-12 |
| P3 | Cube models are YAML or JavaScript files in a model/ folder | https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/data-modeling/concepts/syntax.mdx | 2026-11-12 |
| P3, P4 | Cube multitenancy: up to nine options; contextToAppId alone isolates only compilation; unset scheduledRefreshContexts breaks refresh; queryRewrite for row-level security | https://github.com/cube-js/cube/blob/master/docs-mintlify/embedding/multitenancy.mdx | 2026-11-12 |
| P3 | Cube Store has a router and workers persisting to S3/GCS/MinIO | https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/pre-aggregations/cube-store-architecture.mdx | 2026-11-12 |
| P3, P4 | Cube APIs: REST, GraphQL, SQL over the Postgres wire protocol | https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/core-data-apis/sql-api/index.mdx | 2026-11-12 |
| P3 | Cube hosted MCP server with 30 tools, on all plans | https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/integrations/mcp-server.mdx | 2026-11-12 |
| P3, P1 | Cube data sources page lists 29 connectors (about 26 distinct engines), ClickHouse included | https://github.com/cube-js/cube/blob/master/docs-mintlify/admin/connect-to-data/data-sources/index.mdx | 2026-11-12 |
| P3 | Cube on ClickHouse: pre-aggregations need indexes; export bucket S3 only | https://github.com/cube-js/cube/blob/master/docs-mintlify/admin/connect-to-data/data-sources/clickhouse.mdx | 2026-11-12 |
| P3, P4 | Cube iframe embedding and React Embed SDK on Premium and Enterprise | https://github.com/cube-js/cube/blob/master/docs-mintlify/embedding/index.mdx | 2026-11-12 |
| P3 | Cube issue #8726: per-tenant pre-aggregations stop refreshing with dynamic scheduledRefreshContexts (2024, closed for inactivity) | https://github.com/cube-js/cube/issues/8726 | 2026-11-12 |
| P3 | Cube issue #9892: API vs refresh-worker setup, "No pre-aggregation partitions were built yet" (2025, open) | https://github.com/cube-js/cube/issues/9892 | 2026-11-12 |
| P3 | Cube issues #9494, #9074 (open about 21 months), #10326: ClickHouse pre-aggregation bugs, all now closed | https://github.com/cube-js/cube/issues/9494 ; https://github.com/cube-js/cube/issues/9074 ; https://github.com/cube-js/cube/issues/10326 | 2026-11-12 |
| P3 | Headless BI definition quoted from Cube | https://cube.dev/articles/what-is-headless-bi | 2026-11-12 |
| P3 | dbt Semantic Layer: metrics in YAML in the dbt project; supports Snowflake, BigQuery, Databricks, Redshift, Postgres, Trino only | https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs | 2026-11-12 |
| P3 | dbt SL APIs need Starter, Enterprise or Enterprise+; caching and multiple credentials are Enterprise | https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs | 2026-11-12 |
| P3 | dbt SL APIs: GraphQL, JDBC, Python SDK | https://docs.getdbt.com/docs/dbt-cloud-apis/sl-api-overview | 2026-11-12 |
| P3 | dbt Starter $100/user/month with 5,000 queried metrics | https://www.getdbt.com/pricing | 2026-11-12 |
| P3 | MetricFlow is Apache 2.0; dbt MCP server is Apache 2.0 | https://github.com/dbt-labs/metricflow ; https://github.com/dbt-labs/dbt-mcp | 2026-11-12 |
| P3 | AtScale computes metrics in your platform; lists Snowflake, Databricks, BigQuery, Redshift, PostgreSQL and others (no ClickHouse); XMLA (DAX/MDX) and PostgreSQL interfaces | https://www.atscale.com/integrations/ | 2026-11-12 |
| P3 | AtScale SML is open source (Apache 2.0), YAML in Git | https://www.atscale.com/use-cases/semantic-modeling/ ; https://github.com/semanticdatalayer/sml | 2026-11-12 |
| P3 | AtScale has a read-only MCP server | https://www.atscale.com/use-cases/semantic-context-ai-mcp/ | 2026-11-12 |
| P3 | AtScale prices by deployed semantic objects; no published figures | https://www.atscale.com/pricing/ | 2026-11-12 |
| P3, P1, P4 | GoodData: logical data model per workspace; MAQL proprietary; 23 data sources incl. ClickHouse (tested against 25.1.4, no boolean columns) | https://www.gooddata.ai/docs/cloud/model-data/ ; https://www.gooddata.ai/docs/cloud/create-metrics/maql/ ; https://www.gooddata.ai/docs/cloud/connect-data/ ; https://www.gooddata.ai/docs/cloud/connect-data/create-data-sources/clickhouse/ | 2026-11-12 |
| P1, P3, P4, P5 | GoodData pricing: Professional = platform fee + per workspace, Enterprise custom; no published amounts | https://www.gooddata.ai/pricing/ (redirect from gooddata.com/pricing) | 2026-11-12 |
| P1, P4 | GoodData Professional includes embedding, multi-tenancy, SSO, white-labelling; self-hosting, most AI and MCP server on Enterprise | https://www.gooddata.ai/pricing/ | 2026-11-12 |
| P3, P4 | GoodData embedding: iframe, Web Components, React SDK; workspace data filters; VS Code YAML extension is beta | https://www.gooddata.ai/docs/cloud/embed-visualizations/ ; https://www.gooddata.ai/docs/cloud/workspaces/workspace-data-filters/ ; https://www.gooddata.ai/docs/cloud/api-and-sdk/vs-code-extension/ | 2026-11-12 |
| P3 | Boring Semantic Layer: MIT, built on Ibis, built-in MCP, ~490 stars, v0.3.19 released 2026-11-11; docs name DuckDB, Snowflake, BigQuery, PostgreSQL (not ClickHouse) | https://github.com/boringdata/boring-semantic-layer ; https://github.com/boringdata/boring-semantic-layer/blob/main/docs/md/doc/mcp.md ; https://pypi.org/pypi/boring-semantic-layer/json | 2026-11-12 |
| P1, P4, P5 | Metabase: OSS free (AGPL); Starter $100/mo + $6/user (5 included); Pro $575/mo + $12/user (10 included); Enterprise from $20,000/yr | https://www.metabase.com/pricing/ | 2026-11-12 |
| P1, P4, P5 | Metabase OSS and Starter guest embeds carry the "Powered by Metabase" badge; RLS, SSO, multi-tenant embedding, white-label from Pro | https://www.metabase.com/pricing/ ; https://www.metabase.com/license | 2026-11-12 |
| P1, P4, P5 | Metabase guest-embed viewers don't count as users; SSO-embedded users are billed | https://www.metabase.com/pricing/ ; https://www.metabase.com/docs/latest/embedding/introduction | 2026-11-12 |
| P1, P4, P5 | Metabase guest embeds are view-only (JWT, all plans); SSO embeds add drill-through, query builder, SQL editor, AI chat; static embedding deprecated for guest embeds; modular (web components, React SDK) and full-app iframe; Tenants | https://www.metabase.com/docs/latest/embedding/introduction | 2026-11-12 |
| P1, P4 | Metabase includes a ClickHouse driver | https://www.metabase.com/docs/latest/databases/connections/clickhouse | 2026-11-12 |
| P1, P4, P5 | Power BI Embedded A1 $1.0081/hour East US (from the price feed the Azure page loads); ≈$735.91/month at 730 h (derived) | https://azure.microsoft.com/en-us/pricing/details/power-bi-embedded/ (feed: https://azure.microsoft.com/api/v2/pricing/power-bi-embedded/calculator/?culture=en-us) | 2026-11-12 |
| P1, P4, P5 | Fabric $0.18 per CU-hour East US pay-as-you-go; F2 = $0.36/h ≈ $262.80/month (derived) | https://azure.microsoft.com/en-us/pricing/details/microsoft-fabric/ (feed: https://azure.microsoft.com/api/v3/pricing/microsoft-fabric/calculator/?culture=en-us) | 2026-11-12 |
| P5, P4 | Power BI: viewers need no licence (app owns data); publishers need Pro or a service principal; below F64 or on A SKUs, user-owns-data viewers need Pro/PPU; trial tokens show a banner | https://azure.microsoft.com/en-us/pricing/details/power-bi-embedded/ ; https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-capacity | 2026-11-12 |
| P4 | Power BI embedding: JS and .NET SDKs, REST APIs, secure URL/iframe; RLS effective identity or workspace per tenant with service principal profiles | https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-analytics-power-bi ; https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-row-level-security | 2026-11-12 |
| P4 | Power BI + ClickHouse needs the ClickHouse connector, ODBC driver, and an on-premises gateway for the service | https://clickhouse.com/docs/integrations/connectors/data-visualization/powerbi-and-clickhouse | 2026-11-12 |
| P1, P4, P5 | Sigma pricing not published (/pricing redirects to contact-us) | https://www.sigmacomputing.com/pricing | 2026-11-12 |
| P1, P4, P5 | Sigma secure embeds: one-time JWT-signed URLs; React SDK; JWT claims, RLS, Sigma Tenants; embeddable assistant and agents; embed users auto-created with account_type | https://help.sigmacomputing.com/docs/intro-to-embedded-analytics ; https://help.sigmacomputing.com/docs/manage-access-to-a-secure-embed | 2026-11-12 |
| P1, P4 | Sigma ClickHouse connector is in beta | https://help.sigmacomputing.com/docs/connect-to-clickhouse | 2026-11-12 |
| P4, P5 | ThoughtSpot Embedded: Developer free for 1 year (≤10 users, 25M rows); Enterprise custom, per user/customer; no LLM token charges; lists RLS and multi-tenant by organisation | https://www.thoughtspot.com/pricing | 2026-11-12 |
| P4 | ThoughtSpot Visual Embed SDK (iframe-based) plus REST APIs | https://developers.thoughtspot.com/docs/getting-started | 2026-11-12 |
| P4 | ThoughtSpot native ClickHouse connector | https://clickhouse.com/docs/integrations/connectors/data-visualization/thoughtspot-and-clickhouse | 2026-11-12 |
| P4, P5 | Looker: platform + per-user pricing; Standard, Enterprise, Embed editions all "Call sales"; signed embed users; LookML models; AI in data tokens from 2027-02-01 | https://cloud.google.com/looker/pricing | 2026-11-12 |
| P4 | Looker ClickHouse data source | https://clickhouse.com/docs/integrations/connectors/data-visualization/looker-and-clickhouse | 2026-11-12 |
| P4, P5, P1 | Apache Superset is Apache 2.0; embedded SDK inserts an iframe; guest tokens carry RLS clauses; EMBEDDED_SUPERSET flag | https://superset.apache.org/ ; https://www.npmjs.com/package/@superset-ui/embedded-sdk | 2026-11-12 |
| P4 | Superset + ClickHouse via clickhouse-connect | https://clickhouse.com/docs/integrations/connectors/data-visualization/superset-and-clickhouse | 2026-11-12 |
| P4, P5 | Preset is a managed Superset service; Professional $20/user/month annual; embedding add-on from $500/month for 50 viewers; up to 90% volume discounts on Enterprise; SSO Enterprise | https://preset.io/ ; https://preset.io/pricing/ | 2026-11-12 |
| P4, P5 | Sisense publishes no prices; Self-Serve embeds via iframe or Compose SDK; Enterprise lists multi-tenancy, white-labelling, SSO, on-prem; Compose SDK for React, Angular, Vue; NL queries, BYO LLM | https://www.sisense.com/plans/ ; https://www.sisense.com/ai-analytics-platform/compose-sdk/ | 2026-11-12 |
| P4, P5 | Explo acquired by Omni (announced 2025-10-22); customers migrate over 12 months; explo.co shows "Explo is joining Omni!"; explo.co/pricing returns 404 | https://omni.co/blog/omni-acquires-explo/ ; https://www.explo.co/ ; https://www.explo.co/pricing | 2026-11-12 |
| P4 | Progress completed its acquisition of Domo's platform business on 2026-09-22 ($400M) | https://www.domo.com/news/press/progress-software-completes-acquisition-of-domos-ai-and-data-platform-business ; https://www.progress.com/blogs/progress-software-acquires-domo-to-strengthen-its-ai-data-platform | 2026-11-12 |

## Claims cut because they could not be verified

- **Tableau pricing** (Viewer/Explorer/Creator and embedded pricing): tableau.com returned HTTP 403 to automated
  requests. No Tableau prices appear on any page; Tableau is left out of the pricing tables.
- **Luzmo SSO and iframe embedding**: not stated on the pages read.
- **Embeddable Remarkable Pro licence** and whether the Embeddable platform itself can be self-hosted.
- **Omni pricing** (omni.co/pricing returns 404).
- **Which ThoughtSpot Embedded tier** includes SSO and multi-tenancy (the pricing page shows these as images).
- **Sigma, Looker, ThoughtSpot self-hosting**; **Looker embedding docs** (docs host blocked); **Sisense ClickHouse
  support** (not found; shown as "Not confirmed").
- **Whether Cube Cloud embedded end users need Viewer seats**: not stated; the pricing page tells readers to ask.
- **Boring Semantic Layer ClickHouse support**: its docs don't name ClickHouse; the page says so.
- **Cube "deprecated Redis"** FAQ from the previous /cube-js-alternative page: not re-verified, so removed.
- **dbt Semantic Layer overage price per queried metric**: not published.

# SEO verification log: semantic layer pages (P2)

Same rules as above: every claim about another project, checked live on its own repository, docs, site or
package registry on the date shown. Star counts come from `gh api repos/<owner>/<repo>` and will drift.

Pages:

| # | Page | URL |
|---|---|---|
| S1 | Open-source semantic layer tools | /semantic-layer/open-source-tools |
| S2 | Semantic layer for AI agents | /semantic-layer/ai-agents |

hypequery claims (four MCP tools with no raw SQL tool in TypeScript and Python, tenant scope that fails closed and
rejects agent tenant filters, default 100 rows, ceiling at most 10,000, at most 50 dimensions or measures,
single-dataset execution, Apache 2.0, ClickHouse only, Python in beta, 105 GitHub stars) were checked against
`packages/mcp-server/src` (tool-manifest.ts, args.ts, types.ts, utils/tenant-config.ts,
tools/query-sql.integration.test.ts), `python/hypequery/src/hypequery/mcp`, `python/hypequery/pyproject.toml`
(0.1.0b4), `website-next/docs/(connect)/mcp/safety.mdx` and `gh repo view hypequery/hypequery` on 2026-11-13. The
dataset sample on S2 was type-checked against `@hypequery/datasets@0.31.0` from npm.

| Page | Claim | Source | Checked |
|---|---|---|---|
| S1, S2 | Cube Core: backend Apache 2.0, client MIT; 21,224 stars | https://github.com/cube-js/cube/blob/master/README.md ; https://github.com/cube-js/cube/blob/master/packages/cubejs-client-core/LICENSE | 2026-11-13 |
| S1 | Cube models are YAML or JavaScript files | https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/data-modeling/concepts/syntax.mdx | 2026-11-13 |
| S1 | Cube APIs: REST, GraphQL, SQL over the Postgres protocol; ClickHouse is a data source | https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/core-data-apis/sql-api/index.mdx ; https://github.com/cube-js/cube/blob/master/docs-mintlify/admin/connect-to-data/data-sources/clickhouse.mdx | 2026-11-13 |
| S1, S2 | Cube MCP server: "available on all plans", "30 tools", includes data-model editing tools; Viewer role or higher, tools by role, tokens scoped with tool:<name> | https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/integrations/mcp-server.mdx | 2026-11-13 |
| S1 | Wren Engine merged into Canner/WrenAI under core/ (May 2026); wren-engine archived | https://github.com/Canner/wren-engine ; https://github.com/Canner/WrenAI | 2026-11-13 |
| S1 | WrenAI: code Apache 2.0, docs CC BY 4.0, AGPL reserved for future modules; 18,158 stars; "governed semantic layer, expressed in the Modeling Definition Language (MDL)"; MCP server, CLI, 22+ connectors incl. ClickHouse; built on Apache DataFusion; Wren AI Cloud and Enterprise Plus commercial | https://github.com/Canner/WrenAI/blob/main/README.md ; https://github.com/Canner/WrenAI/blob/main/LICENSE | 2026-11-13 |
| S1 | Lightdash: MIT except packages/backend/src/ee (commercial); 6,230 stars; metrics in dbt YAML or standalone Lightdash YAML; adapters include ClickHouse | https://github.com/lightdash/lightdash/blob/main/LICENSE ; https://github.com/lightdash/lightdash/blob/main/README.md | 2026-11-13 |
| S1 | Lightdash MCP: "Available to all Lightdash Cloud users"; self-hosted needs an Enterprise licence; code under ee/ | https://docs.lightdash.com/references/integrations/lightdash-mcp ; https://github.com/lightdash/lightdash/tree/main/packages/backend/src/ee/services/McpService | 2026-11-13 |
| S1 | MetricFlow Apache 2.0 from v0.209.0 (earlier AGPL, then BSL); 1,876 stars; local mf CLI via pip install dbt-metricflow | https://github.com/dbt-labs/metricflow/blob/main/README.md ; https://github.com/dbt-labs/metricflow/blob/main/LICENSE | 2026-11-13 |
| S1, S2 | dbt Semantic Layer needs Starter, Enterprise or Enterprise+; local CLI has no APIs or integrations; platforms Snowflake, BigQuery, Databricks, Redshift, Postgres, Trino | https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs | 2026-11-13 |
| S1, S2 | dbt MCP server Apache 2.0; Semantic Layer tools (list_metrics, get_dimensions, query_metrics, ...); SQL tools execute_sql and text_to_sql; CLI show "Executes SQL against the database"; disable or allowlist with DISABLE_SQL, DISABLE_DBT_CLI, DISABLE_TOOLS, DBT_MCP_ENABLE_TOOLS | https://github.com/dbt-labs/dbt-mcp/blob/main/README.md | 2026-11-13 |
| S1 | Malloy: MIT (LICENSE file); 2,622 stars; "semantic modeling and query language built on top of SQL"; engines BigQuery, Snowflake, DuckDB, MotherDuck, PostgreSQL, MySQL, Trino, Presto, Databricks (no ClickHouse) | https://github.com/malloydata/malloy/blob/main/README.md ; https://github.com/malloydata/malloy/blob/main/LICENSE | 2026-11-13 |
| S1, S2 | Malloy Publisher (MIT) serves models over REST and MCP | https://github.com/malloydata/publisher/blob/main/README.md | 2026-11-13 |
| S1, S2 | Boring Semantic Layer: MIT, built on Ibis, joint effort of boringdata and xorq-labs; 490 stars; 0.3.19 released 2026-11-11; built-in MCP (MCPSemanticModel) with tools list_models, get_model, get_time_range, query_model, compare_periods; docs do not name ClickHouse | https://github.com/boringdata/boring-semantic-layer ; https://pypi.org/pypi/boring-semantic-layer/json ; https://github.com/boringdata/boring-semantic-layer/blob/main/docs/md/doc/query-agent-mcp.md | 2026-11-13 |
| S1 | AtScale SML: Apache 2.0, YAML, Git-friendly, versions 1.0 to 1.7; 179 stars | https://github.com/semanticdatalayer/SML | 2026-11-13 |
| S1, S2 | AtScale MCP: "The MCP tools are read-only"; tools include list_models, explore_columns, run_query | https://www.atscale.com/use-cases/semantic-context-ai-mcp/ | 2026-11-13 |
| S2 | AtScale lists Snowflake, Databricks, BigQuery, Redshift, PostgreSQL and others; no ClickHouse | https://www.atscale.com/integrations/ | 2026-11-13 |
| S2 | GoodData: "MCP Server with 30+ Tools" on Enterprise only | https://www.gooddata.ai/pricing | 2026-11-13 |
| S2 | GoodData lists 23 data sources, ClickHouse among them | https://www.gooddata.ai/docs/cloud/connect-data/ | 2026-11-13 |
| S2 | Snowflake-managed MCP server tool types: CORTEX_AGENT_RUN, CORTEX_SEARCH_SERVICE_QUERY, CORTEX_ANALYST_MESSAGE, SYSTEM_EXECUTE_SQL (read_only defaults to true; docs advise against exposing it next to a governed agent), GENERIC; per-tool privileges; Snowflake OAuth or external OAuth | https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp | 2026-11-13 |
| S2 | Cortex Analyst uses semantic views | https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst | 2026-11-13 |
| S1 | Apache Ossie (formerly OSI): Apache 2.0 spec for semantic models in YAML/JSON, incubating at the ASF; latest released spec 0.1.1 (2025-12-11); participants include Snowflake, dbt Labs, Salesforce, Databricks, Cube | https://github.com/apache/ossie/blob/main/README.md ; https://github.com/apache/ossie/blob/main/core-spec/spec.md ; https://ossie.apache.org/ | 2026-11-13 |

## Claims cut from S1 and S2 because they could not be verified on 2026-11-13

- **Cube embedding, SSO and pre-aggregations** on S1: verified on 2026-11-12 for P3 but not re-checked; left out.
- **Cube's total source count** ("about 26 engines"): not re-checked; S2 says "many sources, including ClickHouse".
- **Whether Cube's MCP server has a raw SQL tool**: not stated in the sections read; shown as "Not covered".
- **Malloy "nested queries" and editor tooling**, **Lightdash API**: not checked; removed.
- **Cube Cloud free plan**: not re-checked for this page; S1 says only that the MCP server is on all plans.
- **Databricks Genie and metric views** (docs now say "Genie Agents"): not used on S2; the Databricks spoke covers it.
- **Accuracy statistics for text-to-SQL vs semantic layers**: no primary source; none are on either page.
