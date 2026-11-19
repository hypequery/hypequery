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
| P4 | Qrvey: flat-rate pricing for unlimited tenants and users, perpetual licence option, no published prices; Qrvey Pro (bring your own analytics-ready database) and Qrvey Ultra (built-in data engine and transformation layer); built-in engine supports co-mingled and segregated multi-tenant data models | https://qrvey.com/pricing/ | 2026-11-18 |
| P4 | Qrvey embeds through JavaScript components and APIs with token-based authentication, "No iframes, ever"; tenant scopes with row, column, object and feature-level policies; "Self-hosted in your VPC by default" with a managed option | https://qrvey.com/embedded-analytics/ ; https://qrvey.com/multi-tenant-analytics/ | 2026-11-18 |
| P4 | Databrain: Solo $39/mo, Team $199/mo, Business $3,125/mo (monthly billing); viewers free; embedded analytics, white-labelling, multi-tenancy and self-hosting only on Enterprise, quoted per instance with unlimited tenants, end users and embeds | https://www.usedatabrain.com/pricing | 2026-11-18 |
| P4 | Databrain embeds with web components from an npm package (React, Vue, Angular) and a guest token from its API; the token's clientId maps to a tenant column or to a schema/database per tenant; "Unmapped tables remain unfiltered by automatic scope" | https://docs.usedatabrain.com/ ; https://docs.usedatabrain.com/llms.txt ; https://docs.usedatabrain.com/developer-docs/how-to-embed.md ; https://docs.usedatabrain.com/developer-docs/tenancy-model.md | 2026-11-18 |
| P4 | Databrain lists ClickHouse among its data sources | https://www.usedatabrain.com/integrations | 2026-11-18 |
| P4 | Reveal: one fixed price, unlimited users, no extra embed cost per customer, price not published; white-labelling and data connectors included | https://www.revealbi.io/pricing/embedded-analytics | 2026-11-18 |
| P4 | Reveal is a native SDK (React, Angular, Vue.js, Blazor, Web Components) rendering in the app's DOM; cloud, private cloud, on-premises and air-gapped deployment; tenant isolation at the data and session layers with query-level row filtering; conversational analytics and AI-assisted exploration | https://www.revealbi.io/embedded-analytics | 2026-11-18 |
| P4 | Reveal lists ClickHouse as a data source; server SDKs for ASP.NET, Java and Node.js, with some sources unsupported on some platforms | https://help.revealbi.io/web/datasources/ | 2026-11-18 |

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

Added 2026-11-18 (P4): Qrvey's ClickHouse support is shown as "Not confirmed": its pricing, embedded analytics and multi-tenant pages name no ClickHouse connector and https://qrvey.com/data-sources/ returned 404. Reveal's ownership (Infragistics) and the per-platform support of its ClickHouse connector were not checked, so neither is stated. These three vendors' pages were read through a fetch-and-summarise tool, not a full manual read; re-check quoted wording at the next quarterly review.


## Claims cut from S1 and S2 because they could not be verified on 2026-11-13

- **Cube embedding, SSO and pre-aggregations** on S1: verified on 2026-11-12 for P3 but not re-checked; left out.
- **Cube's total source count** ("about 26 engines"): not re-checked; S2 says "many sources, including ClickHouse".
- **Whether Cube's MCP server has a raw SQL tool**: not stated in the sections read; shown as "Not covered".
- **Malloy "nested queries" and editor tooling**, **Lightdash API**: not checked; removed.
- **Cube Cloud free plan**: not re-checked for this page; S1 says only that the MCP server is on all plans.
- **Databricks Genie and metric views** (docs now say "Genie Agents"): not used on S2; the Databricks spoke covers it.
- **Accuracy statistics for text-to-SQL vs semantic layers**: no primary source; none are on either page.

# SEO verification log: Cube gap pages (2026-11-14)

Same rules as above. Gap analysis: `docs/aeo/cube-gap-analysis.md`.

| # | Page | URL |
|---|---|---|
| G1 | Data access control | /semantic-layer/access-control |
| G2 | Analytics MCP server | /semantic-layer/analytics-mcp-server |
| G3 | dbt Semantic Layer alternatives | /semantic-layer/dbt-semantic-layer-alternatives |
| G4 | Build vs buy embedded analytics | /compare/build-vs-buy-embedded-analytics |

hypequery claims were checked against this repository on 2026-11-14. G1's code was type-checked against
`@hypequery/datasets@0.31.0`, `@hypequery/serve@0.26.0` and `@hypequery/clickhouse@2.15.0` from npm, and its SQL
comment is the actual `toSQL()` output. A dataset with a `tenantKey` and no runtime tenant was confirmed to throw
"requires runtime tenant scoping". Specifics:

- Trusted per-call `constraints` (RFC 0019 comparisons via `context.runtime.constraints`): `packages/datasets/CHANGELOG.md` (3492dc9), `src/utils/row-scope.ts`
- Tenant and constraints in cache keys: `docs/(typescript)/(datasets)/datasets/caching.mdx`, datasets CHANGELOG
- Field visibility only in the deployment data plane, not self-hosted Serve: commit e0f9c6e2 (K-07); no masking anywhere
- `requiredRoles` (OR) / `requiredScopes` (AND), `createJwtStrategy` (secret or JWKS), `createAnalyticsTokenIssuer`: `docs/(typescript)/(serve)/authentication.mdx`
- MCP tools, no SQL tool, 100-row default: as logged for S2 on 2026-11-13

| Page | Claim | Source | Checked |
|---|---|---|---|
| G1, G3 | dbt SL platforms: Snowflake, BigQuery, Databricks, Redshift, Postgres, Trino; "other data platforms ... isn't available at this time" | https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs | 2026-11-14 |
| G1, G3 | dbt SL on Starter, Enterprise, Enterprise+; caching (result + declarative, in the data platform, client opt-in) and multiple credentials on Enterprise and Enterprise+; local MetricFlow has no APIs or integrations | https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs | 2026-11-14 |
| G1 | dbt SL auth: service tokens mapped to warehouse credentials, or personal tokens; "physical access policies ... will be respected"; no row-level security in the model | https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs | 2026-11-14 |
| G1 | Cube access policies: `member_level`, `row_level`, `member_masking`, per group, can reference `userAttributes`; combined with `query_rewrite` | https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/data-modeling/data-access-policies.mdx | 2026-11-14 |
| G1 | Cube multitenancy: with `queryRewrite` only, query queue and pre-aggregations are shared; `pre_aggregations_schema` and `context_to_orchestrator_id` isolate them | https://github.com/cube-js/cube/blob/master/docs-mintlify/embedding/multitenancy.mdx | 2026-11-14 |
| G1 | Snowflake row access policies and masking policies | https://docs.snowflake.com/en/user-guide/security-row-intro | 2026-11-14 |
| G1 | ClickHouse row policy: a filter determining which rows a user can read | https://clickhouse.com/docs/sql-reference/statements/create/row-policy | 2026-11-14 |
| G2 | mcp-clickhouse: tools `run_query`, `list_databases`, `list_tables`, `run_chdb_select_query` (chDB); read-only by default via `readonly=1`; `CLICKHOUSE_ALLOW_WRITE_ACCESS`, `CLICKHOUSE_ALLOW_DROP` ("best-effort guard", not a security boundary; restrict grants); stdio and Streamable HTTP (SSE deprecated); HTTP needs bearer token or OAuth by default; Apache 2.0 | https://github.com/ClickHouse/mcp-clickhouse | 2026-11-14 |
| G2, S2 | Cube MCP: all plans, Viewer role or higher, 30 tools, HTTPS + OAuth, `tool:<name>` scopes; `runQuery` runs Cube SQL (PostgreSQL dialect) against the SQL API | https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/integrations/mcp-server.mdx | 2026-11-14 |
| G2, G3 | dbt MCP: Apache 2.0; `execute_sql`, `text_to_sql`, `query_metrics`; CLI `show` "Executes SQL against the database"; `DISABLE_SQL` setting present in `src/dbt_mcp/config/settings.py` | https://github.com/dbt-labs/dbt-mcp | 2026-11-14 |
| G2, G3 | Snowflake MCP, AtScale MCP and integrations, Lightdash, Wren AI, Boring Semantic Layer, Malloy, AtScale SML, MetricFlow licence, Cube Core licence and APIs | As logged for S1/S2 | 2026-11-13 |

G3's HubSources line reads "November 13 and 14, 2026" because its non-dbt, non-Cube-MCP rows reuse the S1/S2
checks from 2026-11-13.

## Corrections made on 2026-11-14

- **S2 (ai-agents)**: Cube's raw SQL cell changed from "Not covered in sources checked" to `runQuery` taking Cube
  SQL against the semantic SQL API. The MCP doc's tool table says so.
- **Cube's own dbt-alternatives article** says the dbt Semantic Layer has no built-in caching. dbt's FAQ documents
  result and declarative caches on Enterprise plans, so G3 says that instead.

## Cut from G1–G4

- **Cube Cloud UI for access policies**: from a Cube blog post in search results, not the docs; left out.
- **Cube "sits on top of dbt models"**: only in Cube's marketing articles; G3 says only that dbt keeps building the
  tables, which is true of every option.
- **Any build-time or cost figures for building embedded analytics**: no primary source; G4 gives none.

# SEO verification log: AI agent pages (2026-11-15)

Pages:

| # | Page | URL |
|---|---|---|
| A1 | hypequery vs ClickHouse Agents | /compare/hypequery-vs-clickhouse-agents |
| A2 | What is agentic analytics? | /blog/agentic-analytics |
| A3 | How to stop an AI agent leaking data between tenants | /blog/ai-agent-multi-tenant-data-isolation |
| A4 | Text-to-SQL vs a semantic layer | /blog/text-to-sql-vs-semantic-layer |

hypequery claims were checked against this repository and run against the published packages on 2026-11-15:
`@hypequery/datasets` 0.31.0 (tenant errors quoted verbatim in A3), `@hypequery/mcp` 0.13.0 and `@hypequery/cli`
1.30.0 (tool list and the `MCP_INVALID_ARGUMENTS` error in A2), and Python `hypequery` 0.1.0b5 (`tenant-required`,
`input-invalid`, the compiled tenant SQL in A3, `between` and the client's default settings in A4). The A3 vitest
tests were run and pass. The TypeScript snippets in A2–A4 type-check.

| Page | Claim | Source | Checked |
|---|---|---|---|
| A1, A2 | "a fully managed agentic analytics service in ClickHouse Cloud, powered by Claude"; announced June 2026 | https://clickhouse.com/blog/clickhouse-agents-beta | 2026-11-15 |
| A1 | Chat can "generate SQL and visualizations"; agent builder with instructions, skills, context files and MCP tool access, governed by Cloud RBAC; sandboxed code interpreter (Bash, Python, JavaScript); memories, artifacts, subagents | https://clickhouse.com/blog/clickhouse-agents-beta | 2026-11-15 |
| A1 | Claude Sonnet and Haiku pre-configured as the default; "Other models can be configured per agent through the Agent Builder" | https://clickhouse.com/blog/clickhouse-agents-beta ; https://clickhouse.com/cloud/agents | 2026-11-15 |
| A1 | "An Agent API for programmatic access to the agents built in ClickHouse Agents" listed under what's next | https://clickhouse.com/blog/clickhouse-agents-beta | 2026-11-15 |
| A1, A2 | Public beta for all ClickHouse Cloud customers "at no additional charge"; "Pricing will be available soon"; "built for your teams"; for AI in your own product, "use ClickHouse as the real-time data layer under your own agent stack"; SSO, sharing and access permissions, encrypted message storage; self-hosting for "maximum runtime control", linking the agentic-data-stack repo | https://clickhouse.com/cloud/agents | 2026-11-15 |
| A1 | Docs label the feature beta; agents can attach tools and MCP servers in the Agent Builder | https://clickhouse.com/docs/products/cloud/features/ai-ml/agents | 2026-11-15 |
| A3 | `CREATE ROW POLICY ... ON ... [FOR SELECT] USING ... TO ...` syntax; "A user to whom no condition applies therefore sees every row"; `access_control_improvements.throw_on_unmatched_row_policies`, disabled by default; "Row policies make sense only for users with readonly access" | https://clickhouse.com/docs/sql-reference/statements/create/row-policy | 2026-11-15 |
| A3 | OWASP Top 10 for LLM applications ranks prompt injection first | https://genai.owasp.org/ | 2026-11-15 |

## Not claimed on A1–A4

- **Which database credentials ClickHouse Agents queries with, and how row policies apply to it**: not stated in
  the announcement, product page or docs overview; A1 says only "governed by Cloud RBAC".
- **Agentic Data Stack components** (LibreChat, Langfuse): only in AI answers and a repo link; A1 names the repo
  and nothing inside it.
- **Text-to-SQL benchmark accuracy figures**: no primary source checked; A4 gives none.

# SEO verification log: /clickhouse-semantic-layer options table and FAQ (2026-11-15)

| Claim | Source | Checked |
|---|---|---|
| dbt Semantic Layer supports Snowflake, BigQuery, Databricks, Redshift, Postgres and Trino; "Support for other data platforms, such as Fabric, isn't available at this time" (ClickHouse is not listed) | https://docs.getdbt.com/docs/use-dbt-semantic-layer/sl-faqs | 2026-11-15 |
| ClickHouse Cloud: AGENTS.md is "a special saved query that acts as a semantic layer over the agent's system prompt"; written as instructions "(not actual SQL)"; applied "to all Assistant chat conversations in that service" | https://clickhouse.com/docs/products/cloud/features/ai-ml/aichat/customizing-semantic-layer | 2026-11-15 |
| Cube: supports ClickHouse among many SQL sources; REST, GraphQL and SQL APIs; MCP server in Cube Cloud; access policies and `queryRewrite` | As logged for P3, G1 and G2 above | 2026-11-12 / 2026-11-14 |
| dbt MCP server; dbt SL relies on the data platform's physical access policies | As logged for G1 and G2 above | 2026-11-14 |

Cut: timbr.ai (ranks #3 for "clickhouse semantic layer") was left out of the options table because its site could not be
reached from the sandbox on 2026-11-15, so its ClickHouse claims are unverified.

## /compare/clickhouse-cloud-vs-tinybird: re-verified 2026-11-18

Every price and product claim on the page and its seed post (`content/blog/2026-08-22-clickhouse-cloud-vs-tinybird.md`) was re-read live. Nothing had changed; only the "checked on" dates moved from 9 to 18 November 2026.

| Claim | Source | Checked |
|---|---|---|
| Tinybird Free: 0.25 vCPU, 1,000 requests a day, 10 GB, no credit card | https://www.tinybird.co/pricing | 2026-11-18 |
| Tinybird Developer "Starting at $25/month"; the 0.5 vCPU size is $49/month with 25 GB included | https://www.tinybird.co/pricing | 2026-11-18 |
| Tinybird SaaS and Enterprise: credit-based billing with a 12-month commitment | https://www.tinybird.co/docs/forward/pricing | 2026-11-18 |
| Tinybird's ClickHouse interface is read-only | https://www.tinybird.co/docs/forward/work-with-data/publish-data/clickhouse-interface | 2026-11-18 |
| Tinybird self-managed regions are in beta, for development environments only | https://www.tinybird.co/docs/forward/install-tinybird/self-managed | 2026-11-18 |
| ClickHouse Cloud: $300 of credits for 30 days; storage $25.30 per TB-month; compute $0.2181 (Basic), $0.2985 (Scale), $0.3903 (Enterprise) per unit-hour | https://clickhouse.com/pricing | 2026-11-18 |
| ClickHouse Cloud Basic running 24 hours a day: $159.66/month compute; 6 hours a day: $66.52/month total (ClickHouse's own worked example) | https://clickhouse.com/docs/cloud/manage/billing/overview | 2026-11-18 |
| ClickHouse BYOC on AWS, GCP and Azure | https://clickhouse.com/cloud/bring-your-own-cloud | 2026-11-18 |

# SEO verification log: hypequery vs Luzmo (2026-11-18)

| # | Page | URL |
|---|---|---|
| L1 | hypequery vs Luzmo | /compare/hypequery-vs-luzmo |

hypequery claims (ClickHouse only, TypeScript datasets and Python datasets in beta at `hypequery` 0.1.0b6, tenant key
that fails closed, REST with OpenAPI, `@hypequery/react` hooks, `@hypequery/mcp` refusing to start without a tenant,
Apache 2.0, no chart components or editor, hypequery cloud in early access with no published price) were checked
against `packages/*`, `python/hypequery/pyproject.toml`, `website-next/docs/` and the wording in
`src/components/home/Hero.tsx` on 2026-11-18. The dataset snippet is the one type-checked for P2 against
`@hypequery/datasets@0.30.0` and `@hypequery/serve@0.25.0`. The Luzmo code sample was copied from the rendered HTML
of the multi-tenant guide (second code block), not from a summary.

| Page | Claim | Source | Checked |
|---|---|---|---|
| L1 | One plan, "Embedded Everywhere", from €1,995/month, billed annually | https://www.luzmo.com/pricing | 2026-11-18 |
| L1 | "Nothing is reserved for a higher plan"; white-label, self-service, AI and APIs included | https://www.luzmo.com/pricing | 2026-11-18 |
| L1 | Licence includes 500 AI conversations and 100 million Warp rows a month; €0.25 per extra million Warp rows; some contracts scale on monthly active users | https://www.luzmo.com/pricing | 2026-11-18 |
| L1 | Free trial of the full product | https://www.luzmo.com/pricing | 2026-11-18 |
| L1 | 19 database integrations, including ClickHouse, Postgres, Snowflake, BigQuery | https://www.luzmo.com/connect | 2026-11-18 |
| L1 | "A metric lives in exactly one place, as a formula, a derived column or a SQL view"; definitions "can be created and maintained programmatically" through the API; "there is no dbt or Cube connector"; no file-based or git workflow described | https://www.luzmo.com/semantic-layer | 2026-11-18 |
| L1 | Multi-tenancy via `parameter_overrides` on a parameter filter (one dataset for all clients) or `account_overrides` (host, user, password per connection); ClickHouse listed among plugins supporting connection overrides | https://developer.luzmo.com/guide/dashboard-embedding--handling-multi-tenant-data | 2026-11-18 |
| L1 | Put the embed filter on the dataset level; users with "use" access to a dashboard can duplicate or modify it and remove a dashboard parameter filter | https://developer.luzmo.com/guide/dashboard-embedding--handling-multi-tenant-data | 2026-11-18 |
| L1 | Code sample (`client.create('authorization', ...)` with `parameter_overrides`), verbatim | https://developer.luzmo.com/guide/dashboard-embedding--handling-multi-tenant-data | 2026-11-18 |
| L1 | Embedding with a web component and React, React Native, Angular and Vue components on npm; embed authorization token generated server-side | https://developer.luzmo.com/guide/dashboard-embedding--embed-into-application | 2026-11-18 |
| L1 | Embedded dashboard editor lets end users create and change dashboards; `editLimited` and `editFull` modes; designer or owner role on the token | https://developer.luzmo.com/guide/dashboard-embedding--embedded-dashboard-editor | 2026-11-18 |
| L1 | Flex: "an SDK that enables you to create customizable visualizations fully from code" | https://developer.luzmo.com/guide/flex--introduction | 2026-11-18 |
| L1 | Luzmo IQ "allows you to generate AI-powered answers to data-related questions"; chat and answer components | https://developer.luzmo.com/guide/iq--introduction | 2026-11-18 |
| L1 | Hosted MCP server giving agents access to Luzmo IQ; EU, US and VPC endpoints; embed key-token per end user "so each user only gets access to their own data"; embed tokens get `search_datasets`, `answer_question`, `create_chart` by default | https://developer.luzmo.com/guide/mcp--introduction | 2026-11-18 |
| L1 | Private infrastructure as an enterprise option (table row "Where it runs") | https://www.luzmo.com/pricing | 2026-11-18 |

## Cut from L1

- **Luzmo USD price** ($2,495/month on the pricing page): left out to match the other pages, which quote euros only.
- **Luzmo MCP server release status** (beta or GA): the MCP page states neither.
- **How Luzmo IQ applies multi-tenant filters**: the IQ introduction does not say; L1 claims only the MCP page's per-user embed token.
- **Luzmo Warp** ("data acceleration layer", from the semantic-layer FAQ): not explained on L1; Warp rows appear only as priced.
- **Homepage "white-label MCP server", Agent API and Analyst agent**: marketing copy with no docs page read; left out.
- **Luzmo SSO and iframe embedding**: still not stated on the pages read (as for P1).
- **ACK (Analytics Component Kit)**: seen only in docs navigation; not read, left out.
