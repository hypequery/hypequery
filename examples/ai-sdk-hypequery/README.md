# AI SDK + hypequery

Minimal Node script showing how to expose hypequery metrics as an AI SDK tool. The
example keeps data in memory so you can focus on the tool pattern and plug in
real ClickHouse access later.

## Setup

```bash
cd examples/ai-sdk-hypequery
npm install
export OPENAI_API_KEY=sk-...
npm run dev
```

The script:

1. Defines a `defineServe` catalog with `weeklyRevenue`, `regionalBreakdown`, and
   `growthNotes` metrics (see `src/api.ts`).
2. Wraps that API in an AI SDK `tool`, enforcing the same Zod schemas.
3. Calls `generateText` with that tool so the model can discover and execute
   metrics safely.

Replace the mock arrays in `src/api.ts` with calls to your real hypequery
project or add additional metrics—no agent prompt changes required.
