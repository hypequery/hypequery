---
"@hypequery/cli": minor
---

`hypequery skill install` adds the `hypequery-onboard` skill: it walks a coding agent through onboarding a ClickHouse database with `schema inspect` and `onboard analyze`, asking the user which tables, business questions and tenant column (never inferred), writing `datasets.ts` (or `datasets.py` and a deployment bundle), running `onboard check` until clean, and optionally `hypequery login`, `deploy` and `deployment:status --mcp-config`. The skills run the CLI as `npx --no-install hypequery` after installing `@hypequery/cli` (or `npx -p @hypequery/cli` in Python projects), so npx never fetches the unrelated unscoped `hypequery` package; the engine install is pinned to `@hypequery/onboard-engine@^0.1`, and the onboarding skill asks the user to put `CLICKHOUSE_PASSWORD` in `.env` themselves instead of typing it into the chat.
