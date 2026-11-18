# Directory listings: checklist and copy

Prepared 2026-11-18 for Luke to submit. Nothing here has been submitted, and no accounts were created. Each directory's
details were read from its own site on 2026-11-18 unless marked **unconfirmed** (the site blocked fetching, so the detail
comes from search results).

Product Hunt is held for the hypequery Cloud launch. Don't submit it.

## Shared listing copy

Use these everywhere, trimmed to each form's limits. Facts to keep consistent: open source (Apache 2.0); ClickHouse only;
TypeScript and Python (Python is in beta); hypequery Cloud is in early access with no published price.

**Name:** hypequery

**One-liner (49 characters):** Embedded analytics on ClickHouse, defined in code

**One-liner, longer (79 characters):** Open-source semantic layer for ClickHouse: endpoints, React hooks and MCP tools

**50 words:**

> hypequery is an open-source semantic layer for ClickHouse. You define datasets, measures and tenant rules in TypeScript
> or Python inside your app repo, then serve them as HTTP endpoints with OpenAPI, typed React hooks and MCP tools for AI
> agents. Every query is scoped to one tenant. Licensed Apache 2.0.

**150 words:**

> hypequery is an open-source semantic layer for teams building analytics on ClickHouse. You define datasets, with their
> dimensions, measures and tenant rules, in TypeScript or Python, in the same repo as your app. Because the model is
> code, a renamed measure fails the type check for every caller, and metric changes show up in pull request diffs.
>
> From one definition, hypequery serves authenticated HTTP endpoints with an OpenAPI spec, typed React hooks for your
> own charts, and MCP tools so agents like Claude and Cursor can query named metrics instead of writing SQL. Queries
> without a tenant are refused. It runs inside your backend, and locally on chDB with no ClickHouse server.
>
> hypequery has no dashboard builder: your team builds the UI with its own components. It is Apache 2.0, and ClickHouse
> lists it as a community integration in its docs. A hosted version, hypequery Cloud, is in early access.

**Toolradar description (under 500 characters, factual):**

> Open-source semantic layer for ClickHouse. Define datasets, measures and tenant rules in TypeScript or Python in your
> app repo, then serve them as HTTP endpoints with OpenAPI, typed React hooks and MCP tools for AI agents. Queries
> without a tenant are refused. Runs in your backend or locally on chDB. No dashboard builder; you build the UI.
> Apache 2.0.

**Who it is for (one sentence):** Engineers building customer-facing dashboards, analytics APIs or AI agents on their own
ClickHouse.

**Key features (each documented on the site):**

1. Datasets with dimensions, measures and metrics in TypeScript or Python: https://hypequery.com/docs/datasets/overview
2. Tenant key per dataset; queries without a tenant fail: https://hypequery.com/docs/datasets/multi-tenancy
3. HTTP endpoints with OpenAPI: https://hypequery.com/docs/datasets/serve-integration
4. Typed React hooks: https://hypequery.com/docs/react/getting-started
5. MCP server with four dataset tools and no SQL tool: https://hypequery.com/docs/mcp/overview
6. Runs locally on chDB: https://hypequery.com/docs/chdb

**Tags:** ClickHouse, semantic layer, embedded analytics, headless BI, customer-facing analytics, analytics API,
TypeScript, Python, React, MCP, multi-tenant, open source

**Pricing summary:** Free and open source (Apache 2.0). hypequery Cloud, the hosted version, is in early access.
Pricing model field: **Free**. Don't enter the planned Cloud tiers until they are on hypequery.com.

**Alternatives to name** (where a form asks for competitors): Cube, Embeddable, Luzmo, Metabase, Apache Superset,
Tinybird.

**Links:**

- Website: https://hypequery.com
- Docs and quick start: https://hypequery.com/docs/quick-start
- GitHub: https://github.com/hypequery/hypequery
- npm: https://www.npmjs.com/org/hypequery
- ClickHouse docs listing:
  https://clickhouse.com/docs/integrations/connectors/data-visualization/community-integrations/hypequery-and-clickhouse

**Proof you can cite:** about 240k monthly npm downloads for `@hypequery/clickhouse` and `@hypequery/datasets` (the
homepage badge showed 243.9K on 2026-11-18), 106 GitHub stars (2026-11-18) and the ClickHouse docs listing. No customer
names, quotes or case studies.

**Images** (paths from `website-next/`):

| Use | File | Size |
|---|---|---|
| Logo, wide, light background | `public/logo.png` | 1378 × 400 PNG |
| Logo, wide, dark background | `public/logo-on-dark.png` | 1378 × 400 PNG |
| Square icon | `public/android-chrome-512x512.png` | 512 × 512 PNG |
| Square icon, transparent | `public/icon.png` | 500 × 500 PNG |
| Screenshot: homepage | `marketing/screenshots/home.png` | 2560 × 1600 |
| Screenshot: ClickHouse MCP page | `marketing/screenshots/clickhouse-mcp.png` | 2560 × 1600 |
| Screenshot: quick start docs | `marketing/screenshots/quick-start.jpg` | 2560 × 1600 |

The screenshots were taken from the live site on 2026-11-18, with the cookie banner removed. Toolradar takes logos up
to 1 MB; every file above is under that.

## Directories

Order: free and self-serve first, then paid, then ones with no submission route.

### 1. SaaSHub (free)

- [ ] Submitted
- Submit: https://www.saashub.com/services/submit (needs an account: https://www.saashub.com/register)
- Rules from the submit page:
  - List competitors, or the submission goes to the back of the queue.
  - Verify with an @hypequery.com email for priority.
  - Waitlist pages and unreleased products are refused, so lead with the open-source project and link
    https://hypequery.com, not a Cloud waitlist.
  - The page says the product owner should submit it in person.
- Categories:
  - Embedded Analytics: https://www.saashub.com/best-embedded-analytics-software
  - Developer Tools: https://saashub.com/best-developer-tools-software
  - Business Intelligence: https://www.saashub.com/best-business-intelligence-software
- Competitors to name:
  - Luzmo: https://www.saashub.com/luzmo-alternatives
  - Embeddable: https://www.saashub.com/embeddable-alternatives
  - Cube.js: https://www.saashub.com/cube-js-alternatives
  - Don't use https://www.saashub.com/cube-alternatives; it is a different product, an FP&A tool.
- After verification, SaaSHub's free "Submit" tool (https://www.saashub.com/submit/list) lists about 110 more
  directories.
- Copy: name, longer one-liner, 150 words, tags, pricing Free.

### 2. Toolradar (free)

- [ ] Submitted
- Submit: https://toolradar.com/company/submit. Guide: https://toolradar.com/vendors/guides/list-your-software
- Access: you need a company account verified with an @hypequery.com email or a DNS record before the form opens.
  Limit of 2 submissions an hour.
- Fields:
  - Name: 60 characters or fewer
  - Tagline: one sentence
  - Description: 500 characters or fewer, no marketing language; use the Toolradar description above
  - Who it is for
  - At least 3 key features, each documented on the site; use the list above
  - Website
  - Pricing model: Free
  - Optional: logo (1 MB maximum), up to 5 screenshot URLs, FAQ
- Categories:
  - Analytics: https://toolradar.com/best/analytics
  - Developer Tools: https://toolradar.com/best/developer-tools
  - Business Intelligence: https://toolradar.com/best/business-intelligence
  - API Tools: https://toolradar.com/best/api-tools
- Competitors listed:
  - Luzmo: https://toolradar.com/tools/luzmo
  - Embeddable: https://toolradar.com/tools/embeddable
  - Cube: https://toolradar.com/tools/cube
- Screenshot URLs: Toolradar wants URLs, not uploads. Once this PR merges, the files are on GitHub at
  `website-next/marketing/screenshots/` (use the raw URLs), or use https://hypequery.com/og.

### 3. AlternativeTo (already listed: update it)

- [ ] Updated
- Listing: https://alternativeto.net/software/hypequery/ (edit from the listing's About page while signed in as
  lureilly1).
- What it shows today:
  - Description: "The TypeScript semantic layer for ClickHouse."
  - Category: AI Tools & Services
  - Tags: Api, clickhouse-client, analytics, semantic-layer, clickhouse, typescript
  - Platforms: Windows, Mac, Linux, JavaScript, TypeScript, npm
  - Licence: Open Source (Apache-2.0)
  - Features: MCP Support, Dashboard
  - Alternatives: Metabase, Apache Superset, Redash, Cube.js, Lightdash, and one blank entry
- Changes:
  - Description: replace it with the 150-word copy. It no longer mentions TypeScript only: Python, endpoints, React
    hooks and tenant scope are missing.
  - Category: Business Intelligence or Developer Tools, instead of AI Tools & Services.
  - Platforms: add Self-Hosted and Python.
  - Features: remove "Dashboard" (there is no dashboard builder). Add embedded analytics, multi-tenancy and API.
  - Tags: add embedded-analytics, headless-bi, python, react, mcp.
  - Alternatives: add hypequery as an alternative to:
    - Embeddable: https://alternativeto.net/software/embeddable/
    - Luzmo (still under its old Cumul.io slug): https://alternativeto.net/software/cumul-io/
    - Cube.js is already linked: https://alternativeto.net/software/cube-js/
  - Remove the blank alternative entry if you can.
- Add the three screenshots.

### 4. WebCatalog (free; web apps only)

- [ ] Submitted
- Submit: https://webcatalog.io/en/developers/app-listing (sign-in required). It asks only for the app name and URL.
- WebCatalog lists web apps that work in a browser, so this fits hypequery Cloud better than the libraries. **Wait for
  the Cloud launch** unless you're happy to list https://hypequery.com.
- Categories:
  - Embedded Business Intelligence Software: https://webcatalog.io/en/apps/tag/embedded-business-intelligence-software
  - Analytics Platforms: https://webcatalog.io/en/apps/tag/analytics-platforms
- Luzmo is listed: https://webcatalog.io/en/apps/luzmo. Embeddable and Cube aren't.

### 5. hostedsoftware.org (free and slow, or $49)

- [ ] Submitted
- Submit: the form on the homepage, https://hostedsoftware.org (https://hostedsoftware.org/submit returns 404).
- Cost: free gets a no-follow link added in about 3 months; $49 gets immediate publication and a do-follow link. The
  $49 option is a purchase, so it's your call.
- Category: Analytics Platform, https://hostedsoftware.org/categories/analytics-platform/ (Metabase, Superset and
  PostHog are there). Fallback: Software Development Tool.
- It's a self-hosted software directory, so stress that hypequery runs in your own backend.

### 6. SoftwareWorld (paid, about $99: unconfirmed)

- [ ] Submitted
- The site returned 403 to our fetches, so everything here is **unconfirmed**.
- Route: create a vendor account at https://www.softwareworld.co/register, complete the vendor profile, then submit a
  listing. Search results quote a one-time $99 approval fee for new listings.
- Fields reported: name, website, vendor, category, licensing (choose open source), deployment. Logo is JPG, GIF or
  PNG, 800 KB maximum; `public/logo.png` qualifies.
- Categories:
  - Embedded Analytics: https://www.softwareworld.co/embedded-analytics-software/comparison/
  - Free Embedded Analytics: https://www.softwareworld.co/free-embedded-analytics-software/
- Embeddable is listed: https://www.softwareworld.co/software/embeddable-reviews/
- Don't confuse it with softwareworlds.com (with an "s"), a different site.

### 7. TopTool (paid, about $19.99: unconfirmed)

- [ ] Submitted
- The site returned 429 to our fetches, so everything here is **unconfirmed**.
- Submit: https://www.toptool.app/en/submit (website URL and email). Reported price is $19.99 per tool, with a free
  route if you share it on social.
- Listings are generated automatically from your site. Check the result, and email general@toptool.app with any
  corrections.

### 8. whatarethebest.com (paid placement only)

- [ ] Decided
- There is no free submission. Paid promotion is at https://www.whatarethebest.com/promote-your-company.cfm: $1,000
  for 3 months, $3,000 for 12, $5,000 for life. That buys a promoted spot, not a ranking.
- For an editorial listing the only route is email (albert@whatarethebest.com). It isn't clear they accept these.
- Target page: Embedded Analytics Platforms for SaaS Products,
  https://whatarethebest.com/embedded-analytics-platforms-for-saas-products/ (Luzmo is ranked there).
- Recommendation: skip the paid placement, since the handoff rules out paid tools and ads. Send one short email if you
  want to try.

### 9. shouldiuse.io (no submission route)

- [ ] Checked
- It isn't a directory. Anyone pastes a product URL and the site writes a buy / don't buy / depends report from public
  sources, cached for about a month.
- Action: run a check on https://hypequery.com at https://shouldiuse.io and read the report. If it gets facts wrong,
  email hello@shouldiuse.io with corrections.

### 10. Partnerbase (no submission route)

- [ ] Skipped
- It's a partnerships directory run by Crossbeam. Companies appear through tracked partnerships, not product
  submissions. Luzmo is there because of its partner list (https://www.partnerbase.com/cumul-io).
- It's worth revisiting only once hypequery has formal partnerships.
