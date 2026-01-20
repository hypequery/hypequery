# Next.js + @hypequery/serve example

This example shows how to expose hypequery routes inside a Next.js App Router project.

## Commands

```bash
pnpm install
cp .env.example .env   # fill in ClickHouse credentials
pnpm run dev
```

The `app/api/hypequery/[...hq]/route.ts` route handler forwards every request to the shared
`defineServe` instance in `lib/api.ts`. The dashboard page invokes those endpoints using
`fetch("/api/hypequery/...")` and automatically benefits from validation, OpenAPI docs, and the
built-in docs UI at `/api/hypequery/docs`.

### Notes

- The serve instance is configured with `basePath: "/api/hypequery"` so all registered routes map
  under the Next.js API segment.
- The handler uses the edge runtime via `createVercelEdgeHandler`, but you can swap to the Node
  adapter if you prefer `runtime = "nodejs"`.
- Visit `/api/hypequery/docs` for the generated Redoc UI or `/api/hypequery/openapi.json` for the
  raw spec.
