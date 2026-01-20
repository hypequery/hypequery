# Node Embedded Example

Run hypequery definitions directly from a Node process—no HTTP server required.
Point the project at your ClickHouse database and call `api.run()` wherever you
need analytics (cron jobs, CLI tools, workers, etc.).

## Setup

```bash
cd examples/node-embedded
pnpm install
cp .env.example .env   # update values for your ClickHouse instance
pnpm run dev
```

`src/analytics/api.ts` defines a small serve catalog backed by ClickHouse. The
`scripts/index.ts` file executes those metrics in-process and prints the
results, but you could import the same `api` anywhere else in your app to reuse
exact logic.
