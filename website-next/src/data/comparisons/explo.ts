import { tenantScopedDatasetCode } from '@/data/comparisons/hypequery-code';
import type { ComparisonPage } from '@/data/comparisons/types';

const CHECKED = '2026-11-22';

export const exploComparison: ComparisonPage = {
  slug: 'hypequery-vs-explo',
  path: '/compare/hypequery-vs-explo',
  competitor: 'Explo',
  primaryKeyword: 'explo alternative',
  title: 'Explo Alternative After Omni: hypequery vs Explo',
  description:
    'Explo is joining Omni and the Explo platform is being sunset. Compare Explo, Omni and hypequery, an open-source ClickHouse semantic layer.',
  h1: 'hypequery vs Explo',
  published: CHECKED,
  verifiedOn: CHECKED,
  tldr: [
    'Explo is a hosted embedded analytics product (dashboards, a Report Builder and Explo AI) that Omni announced it was acquiring in October 2025, with the Explo platform to be sunset after a migration window.',
    'It suited SaaS teams that wanted customer-facing dashboards built in a hosted editor and embedded with a web component or iframe; today, Omni is the migration path its owners recommend.',
    'hypequery is a different kind of tool, a set of open-source TypeScript and Python libraries that define tenant-scoped ClickHouse metrics in your repo and serve them to your own React UI, APIs and AI agents.',
  ],
  notice: {
    title: 'Explo is being folded into Omni',
    body:
      'Omni announced its acquisition of Explo on October 22, 2025. Omni’s Explo page says existing customers keep full access to the Explo platform for 12 months and strongly encourages them to finish migrating before the sunset date. No exact sunset date is published, and as of November 22, 2026 neither site says whether the platform has shut down. Explo’s changelog has no entries after September 30, 2025, and its pricing page returns a 404. If you run Explo today, the question is where to move.',
  },
  rows: {
    deployment: {
      hypequery: 'Libraries in your backend; ClickHouse is the only service involved. hypequery Cloud (hosted) is in early access.',
      competitor:
        'Hosted SaaS that queries your database on each request and does not store your data; dedicated hosting and isolated connectivity regions for enterprise customers',
    },
    license: {
      hypequery: 'Apache 2.0, every package',
      competitor: 'Commercial hosted product; we found no open-source release',
    },
    dataSources: {
      hypequery: 'ClickHouse only: ClickHouse Cloud, self-hosted ClickHouse, chDB',
      competitor: '17 sources on its integrations page, including Postgres, Snowflake, BigQuery, Redshift, Databricks and ClickHouse',
    },
    clickhouse: {
      hypequery:
        'Built for ClickHouse. Types are generated from your live schema, SQL compiles straight to the ClickHouse dialect, and `FINAL` and query settings are supported',
      competitor:
        'Dedicated connector over the ClickHouse native protocol with SSL; its newer FIDO connector also needs HTTPS (port 8443) allowlisted',
    },
    tenantIsolation: {
      hypequery:
        '`tenantKey` per dataset, filled from your auth. Queries without a tenant fail, and callers cannot filter on the tenant column.',
      competitor:
        'Customer groups plus a SQL variable in each dataset (`{{customer_id}}`), or one data source per customer through schemas; embed JWTs carry the customer token',
    },
    semanticLayer: {
      hypequery: 'Datasets with dimensions, measures (including derived), relationships, filters and limits, in code',
      competitor: 'Global Datasets: SQL-defined, reusable datasets with commit history in a Data Library, which Explo says function as a semantic layer',
    },
    api: {
      hypequery: 'Generated HTTP endpoints per dataset with request validation and OpenAPI; direct function calls in-process',
      competitor: 'REST API for customers, embed tokens, publishing and exports (PDF, image, email); we found no endpoint that queries data',
    },
    agents: {
      hypequery: 'MCP server and generated tools over your datasets; agents choose measures and dimensions and never write SQL',
      competitor: 'Report Builder AI, a chat for end users to build views; we found no MCP server in Explo’s docs',
    },
    embedding: {
      hypequery:
        'Headless: typed React hooks and HTTP endpoints, you draw the charts. Embeddable dashboards and chat in hypequery Cloud are coming soon.',
      competitor: '`<explo-dashboard>` web component, iframe, or a hosted customer portal; Report Builder embeds the same ways',
    },
    pricing: {
      hypequery: 'Open source and free. Cloud is in early access with no published price.',
      competitor: 'No published pricing: explo.co/pricing returns a 404. Omni says existing contracts keep their pricing until they end.',
    },
  },
  competitorBetterWhen: [
    'You are an Explo customer and want the shortest migration. Omni is the path Explo’s new owner supports, with an Omni account team once you have moved, and hypequery is a rebuild rather than a migration.',
    'Non-engineers build the customer dashboards. Explo, and Omni after it, give you a hosted editor; hypequery has no editor, so every chart change is an engineering change.',
    'Your data is outside ClickHouse. Explo lists 17 sources; hypequery supports only ClickHouse.',
    'Your customers want to build their own reports. Explo’s Report Builder covers that; hypequery does not.',
  ],
  chooseHypequeryWhen: [
    'You are leaving Explo anyway and would rather own the analytics layer than move to another hosted vendor that could change hands too.',
    'Your data is in ClickHouse and you want metric definitions in TypeScript or Python files, reviewed in pull requests and type-checked against every caller.',
    'Your product already has a design system. hypequery returns typed data and you render it with the components you already ship, so there is no iframe or third-party web component to theme.',
    'You need the same numbers in a public API or an AI agent. One dataset serves the dashboard, the OpenAPI endpoint and the MCP tools with the same tenant rule.',
    'You want no per-viewer or per-customer pricing. The libraries are Apache 2.0 and run on infrastructure you already pay for.',
  ],
  sections: [
    {
      id: 'after-the-acquisition',
      eyebrow: 'Migrating',
      title: 'Three ways out of Explo',
      paragraphs: [
        'Teams leaving Explo usually take one of three routes. Omni is the vendor-supported path. Its embedded analytics uses signed embed URLs, `entity` groups and user attributes for row-level permissions, a semantic model and an MCP server, and it connects to ClickHouse. Another embedded BI vendor, such as Luzmo or Embeddable, keeps the hosted-editor workflow. Or you build the front end yourself on a data layer you own.',
        'hypequery is for the third route on ClickHouse. It is not a drop-in replacement. There is no dashboard editor to import Explo dashboards into, and someone writes the charts. What you get in exchange is analytics that lives in your repo, ships with your app and does not depend on a vendor’s roadmap. For the other routes, see [Luzmo alternatives](/compare/luzmo-alternatives), [Embeddable alternatives](/compare/embeddable-alternatives) and the [embedded analytics platforms](/compare/embedded-analytics-platforms) comparison.',
      ],
    },
    {
      id: 'tenant-isolation',
      eyebrow: 'Multi-tenancy',
      title: 'How Explo scoped customers, and how hypequery does',
      paragraphs: [
        'Explo’s model is the customer group, a security group that can only see its own data. For a shared table, each dataset’s SQL carries a variable, for example `[[AND fieldFromDB = {{customer_id}}]]`, that Explo fills per customer. For one database per customer, schemas map each customer to its own data source. Embeds are authorised with an expiring JWT whose encrypted body hides the dashboard ID and customer token, which Explo’s security FAQ recommends over the older non-expiring customer token.',
        'The weakness of a per-dataset SQL variable is that every dataset author has to remember it. hypequery moves the rule into the dataset definition. `tenantKey` names the column once, the compiler adds the predicate to every query, and a query without a tenant fails instead of returning every customer’s rows. The [multi-tenancy docs](/docs/datasets/multi-tenancy) cover trusted multi-tenant scopes for admin views.',
      ],
    },
    {
      id: 'rebuild-scope',
      eyebrow: 'Effort',
      title: 'What rebuilding an Explo dashboard on hypequery involves',
      paragraphs: [
        'Each Explo Global Dataset becomes a hypequery dataset: the SQL’s source table becomes `source`, its group-by columns become dimensions, its aggregates become measures, and the customer variable becomes `tenantKey`. Joins become relationships. The dashboard itself becomes React components calling typed hooks, with charts from whatever library your app uses.',
        'Expect the data layer to be the quick part and the UI to be most of the work. If that UI work is the reason you bought Explo in the first place, a hosted vendor is the better fit, and the [build vs buy guide](/compare/build-vs-buy-embedded-analytics) puts numbers on that decision. For more on the category, start with [embedded analytics](/embedded-analytics).',
      ],
    },
  ],
  code: {
    hypequery: tenantScopedDatasetCode,
  },
  faq: [
    {
      question: 'Is Explo shutting down?',
      answer:
        'Omni announced it was acquiring Explo on October 22, 2025. Omni’s Explo page says customers keep full access for 12 months and encourages them to migrate before the sunset date, which it does not state. As of November 22, 2026 neither Omni nor Explo says whether the platform has been switched off.',
    },
    {
      question: 'What is the best Explo alternative?',
      answer:
        'It depends on why you used Explo. For the least migration work, Omni is the supported path. To keep a hosted dashboard editor with another vendor, look at embedded BI products such as Luzmo or Embeddable. If your data is in ClickHouse and you want to own the analytics layer and UI in code, hypequery fits.',
    },
    {
      question: 'Does Explo support ClickHouse?',
      answer:
        'Yes. Explo has a ClickHouse connector that uses the native protocol over SSL, and its newer FIDO connector also connects over HTTPS on port 8443. hypequery supports only ClickHouse.',
    },
    {
      question: 'How much does Explo cost?',
      answer:
        'Explo no longer publishes pricing, and explo.co/pricing returned a 404 on November 22, 2026. Omni says existing Explo contracts keep their pricing until the current contract ends. hypequery is free and open source.',
    },
    {
      question: 'Can I migrate Explo dashboards into hypequery?',
      answer:
        'Not automatically. hypequery has no dashboard editor or import. You recreate each Explo dataset as a hypequery dataset (source table, dimensions, measures and a tenant key) and rebuild the charts as React components on typed hooks.',
    },
  ],
  sources: [
    { claim: 'Omni announced acquiring Explo on 2025-10-22; Explo product to function as today during transition', url: 'https://omni.co/blog/omni-acquires-explo/', checkedAt: CHECKED },
    { claim: 'Existing customers keep full access for 12 months; migrate before the sunset date; pricing unchanged until contract end', url: 'https://omni.co/explo', checkedAt: CHECKED },
    { claim: 'Explo homepage banner "Explo is joining Omni!"; products Dashboard, Report Builder AI, Data Share, Explo AI', url: 'https://www.explo.co/', checkedAt: CHECKED },
    { claim: 'Latest changelog entry 2025-09-30', url: 'https://www.explo.co/changelog', checkedAt: CHECKED },
    { claim: 'explo.co/pricing returns 404', url: 'https://www.explo.co/pricing', checkedAt: CHECKED },
    { claim: 'Explo queries your database each time and stores no customer data', url: 'https://docs.explo.co/faqs', checkedAt: CHECKED },
    { claim: 'Isolated connectivity regions for enterprise customers', url: 'https://docs.explo.co/data-sources/connecting-to-data-sources/connectivity-regions', checkedAt: CHECKED },
    { claim: '17 data sources listed, ClickHouse among them', url: 'https://www.explo.co/integrations', checkedAt: CHECKED },
    { claim: 'ClickHouse via native protocol over SSL; FIDO connector also uses HTTPS 8443', url: 'https://docs.explo.co/data-sources/connecting-to-data-sources/data-source-types/clickhouse', checkedAt: CHECKED },
    { claim: 'Customer groups; dataset SQL variables like {{customer_id}}', url: 'https://docs.explo.co/customers/overview', checkedAt: CHECKED },
    { claim: 'Schemas map each customer to a data source', url: 'https://docs.explo.co/data-sources/data-sources-and-schema/multiple-data-sources', checkedAt: CHECKED },
    { claim: 'Embed secrets are expiring JWTs with an encrypted body', url: 'https://docs.explo.co/embedding-documentation/embed-secrets/intro', checkedAt: CHECKED },
    { claim: 'Security FAQ recommends JWTs over the non-expiring customer token', url: 'https://docs.explo.co/security/security-faqs', checkedAt: CHECKED },
    { claim: 'Global Datasets function as a semantic layer, SQL-defined with commit history', url: 'https://docs.explo.co/data-sources/data-library/global-datasets', checkedAt: CHECKED },
    { claim: 'REST API covers customers, resources, exports and embed JWTs', url: 'https://docs.explo.co/api-reference/overview', checkedAt: CHECKED },
    { claim: 'Report Builder AI chat for end users', url: 'https://docs.explo.co/report-builder-features/report-builder-ai', checkedAt: CHECKED },
    { claim: 'Web component <explo-dashboard> works in React, Vue, Angular', url: 'https://docs.explo.co/embedding-documentation/dashboard/option-1-web-component', checkedAt: CHECKED },
    { claim: 'Iframe and web component embedding options compared', url: 'https://docs.explo.co/embedding-documentation/web-component-vs-iframe', checkedAt: CHECKED },
    { claim: 'Omni embedded analytics: semantic model, APIs and MCP server', url: 'https://omni.co/embedded-analytics', checkedAt: CHECKED },
    { claim: 'Omni embeds use signed URLs; entity and userAttributes for row-level permissions', url: 'https://docs.omni.co/embed/setup/url-parameters/entity.md', checkedAt: CHECKED },
    { claim: 'Omni supports ClickHouse', url: 'https://docs.omni.co/connect-data/setup/clickhouse.md', checkedAt: CHECKED },
  ],
  hubCard: {
    bestFitFor: 'Existing Explo customers, whose supported path is now Omni after the October 2025 acquisition.',
    chooseHypequeryWhen: 'You are leaving Explo, your data is in ClickHouse, and you would rather own the metrics and UI in code than move to another hosted vendor.',
  },
};
