---
"@hypequery/cli": minor
---

Add `hypequery export:client-contract <api-file>`. It writes the client contract of a TypeScript serve API (`client-contract.json` by default) for `hypequery generate:client`, with `--output`, `--stdout`, `--check` and `--force`, matching Python's `hypequery export client-contract`. Like Python, it refuses a contract with no endpoints.
