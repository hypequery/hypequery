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
