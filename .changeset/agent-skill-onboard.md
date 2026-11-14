---
"@hypequery/cli": minor
---

`hypequery skill install` adds the `hypequery-onboard` skill: it walks a coding agent through onboarding a ClickHouse database with `schema inspect` and `onboard analyze`, asking the user which tables, business questions and tenant column (never inferred), writing `datasets.ts` (or `datasets.py` and a deployment bundle), running `onboard check` until clean, and optionally `hypequery login`, `deploy` and `deployment:status --mcp-config`.
