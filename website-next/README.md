# hypequery.com

This Next.js application powers the hypequery website, documentation, comparison pages, and ClickHouse TypeScript guides.

## Run locally

```bash
cd website-next
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Pages and MDX documentation update during development.

## Main content locations

| Path | Contents |
| --- | --- |
| `src/app/` | Next.js routes, landing pages, sitemap, and metadata |
| `docs/` | Product documentation rendered by Fumadocs |
| `content/blog/` | Markdown blog and migration guides |
| `src/data/compare-pages.ts` | Comparison index data and FAQs |
| `src/data/compare-articles.ts` | Promoted long-form comparison content |
| `src/data/homepage-content.ts` | Homepage examples and copy |
| `public/` | Logos, icons, and static images |

## Checks

```bash
npm run lint
npm test
npm run build
```

The production build validates TypeScript, MDX compilation, static routes, and page metadata. When you add a documentation page, include it in `docs/meta.json`. When you add a public route, confirm it is discoverable through internal links and the generated sitemap.

## Writing product docs

- Prefer a runnable example over an abstract feature claim.
- Use the real package and method names from the monorepo.
- Link to `/docs/capabilities` when stating the current supported surface.
- Keep ClickHouse, TypeScript, semantic layer, query builder, multi-tenant analytics, React, and MCP language natural and specific.
- Avoid copying stale caveats from older blog posts into current reference documentation.

## Deployment

The site is configured for Vercel through `vercel.json`. Build it locally before publishing:

```bash
npm run build
```

## CLI telemetry endpoint

`POST /api/telemetry` accepts the published CLI's allowlisted schema-v1 batches.
Set these server-side Vercel production environment variables, then deploy:

```dotenv
POSTHOG_PROJECT_TOKEN=phc_your_project_token
TELEMETRY_PROJECT_HMAC_SECRET=your_random_secret_at_least_32_bytes
# Optional; defaults to the US ingestion host:
POSTHOG_HOST=https://eu.i.posthog.com
```

Generate the HMAC secret with `openssl rand -hex 32`; retain it across deployments
so project identifiers stay stable. Keep all three values server-side (no
`NEXT_PUBLIC_` prefix).

The CLI sends to this endpoint by default unless the user opts out;
`HYPEQUERY_TELEMETRY_URL` overrides it for staging. CLI versions released before
default collection send only when that variable is set. Debug mode prints events
without sending.
The endpoint returns 503 until configured and 202 after validation. Next.js
`after()` forwards to PostHog with a three-second timeout, without client IP,
cookies or user-agent headers. Project hashes are HMAC-rekeyed before forwarding.
Delivery is best effort, without a durable queue or retries. CLI releases after
1.22.0 hand each batch to a detached sender process with a five-second budget, so
cold starts no longer drop requests; 1.22.0 and earlier abort after 40ms.

### Rate limiting

The endpoint is public and the CLI's `api_key` marker is not an authentication
secret, so every request is checked against a Vercel Firewall rate limit
(`@vercel/firewall`) before its body is read. Before configuring the endpoint,
add a Firewall custom rule in the Vercel project: condition `@vercel/firewall`
with rate-limit ID `cli-telemetry`, and a Rate Limit action keyed by client IP
(for example 120 requests per 60-second window). Each CLI invocation sends at
most one request; leave headroom for CI fleets behind a shared egress IP.

Requests over the limit get 429, which the CLI drops without retrying. Until
the rule exists the endpoint returns 503, so collection cannot run unprotected.
If the Firewall check itself errors or times out (one second), the request is
allowed and a generic message is logged.

Only for a deliberate version kill switch, set
`TELEMETRY_DISABLED_CLI_VERSIONS=1.2.3,1.2.4`; a validated matching request gets
410 and that CLI version disables collection on that installation. Upstream
failures log only a generic message/status and never cause a 410.

When changing the CLI event catalog, run `npm run telemetry:schema` from this
directory and commit the generated contract. `npm test` checks contract drift.
