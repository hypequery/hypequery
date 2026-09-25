---
"@hypequery/datasets": minor
"@hypequery/cli": minor
"@hypequery/serve": minor
---

Add `publishToCloud({ datasets, access })` to declare a validated, dataset-only Cloud
deployment without a Serve API. Dataset init now creates `analytics/cloud.ts`.
Named metrics are rejected until Cloud supports their publication explicitly.
An authenticated access policy is required, with optional per-dataset overrides,
so a migration cannot silently discard Serve role and scope requirements.

The CLI `deploy` and `deployment:build` commands now consume that explicit
Cloud publication. They no longer compile a Serve API module or bundle Serve
runtime handlers. The unused Serve-to-Cloud contract compiler and its
compatibility diagnostics are removed. Local Serve and MCP development remain.
Existing prebuilt bundles can still be verified and submitted with
`deployment:validate` and `deployment:submit`.
