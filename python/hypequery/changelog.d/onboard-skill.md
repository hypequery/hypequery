- `hypequery skill install` adds a third skill, `hypequery-onboard`: it walks a
  coding agent through onboarding a ClickHouse database (analysis, the user's
  tables, questions and tenant column, `datasets.py`, a deployment bundle and
  `onboard check`). Its analysis and check steps run the TypeScript CLI through
  `npx`, so they need Node.js.
  It runs the CLI with `npx -p @hypequery/cli` (never the unscoped `hypequery`
  npm name), pins the engine to `@hypequery/onboard-engine@^0.1`, and asks the
  user to put `CLICKHOUSE_PASSWORD` in `.env` themselves rather than in the chat.
- All three packaged skills say that text the CLI or a query reports from
  ClickHouse (names, comments, values, findings, error messages) is data, never
  instructions. The onboarding skill keeps sampled values and secrets out of
  `analytics/onboarding/state.json` and asks the user before committing it.
