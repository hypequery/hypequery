# Next Dashboard Example

A full Next.js App Router dashboard wired up to hypequery. One `defineServe`
API powers every route:

- `/` – client components call `useHypequeryQuery` (TanStack Query) for metrics,
  charts, and the paginated trips table.
- `/cache` – server component that runs cached metrics via `api.run()` and lets
  you invalidate tags.
- `/nodejs-example` – server route showing how to call the same definitions from
  an API handler.
- `/api/streaming` – NDJSON streaming endpoint backed by `QueryBuilder.stream()`.
Measurements stay in `src/analytics/api.ts`, so adding metrics or changing
schemas immediately updates every consumer (React hooks, server actions, AI
agents, etc.).

## Getting Started

```bash
cd examples/next-dashboard
pnpm install
cp .env.example .env   # update values for your ClickHouse instance
pnpm run dev
```

When the dev server is running you can also explore `/api/hypequery` to see the
serve runtime plus OpenAPI docs.

To test streaming, hit:

```
curl http://localhost:3000/api/streaming
```
