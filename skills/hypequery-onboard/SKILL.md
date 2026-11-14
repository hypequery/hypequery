---
name: hypequery-onboard
description: Set up hypequery on a ClickHouse database from a coding agent, end to end. Use when asked to add analytics, a semantic layer or MCP access over ClickHouse tables, to onboard a project onto hypequery, or to turn ClickHouse tables into datasets (TypeScript or Python); walks schema inspect, onboard analyze, questions to the user, writing datasets, onboard check, and optional deploy to hypequery Cloud.
---

# Onboarding a ClickHouse project onto hypequery

You turn the user's ClickHouse tables into hypequery datasets that answer their
business questions, with evidence from the data instead of guesses. The CLI
does the analysis; you ask the user what only they know, write the datasets,
and check them until the checks are clean.

Rules:

- **Never set `tenantKey` (or `tenant_key`) unless the user named the column.**
  The analysis lists possible tenant columns; they are questions, not answers.
  Record the user's answer verbatim in `analytics/onboarding/plan.md`.
- Never write SQL to answer a business question; answer it with a dataset query.
- Prefer few datasets with good descriptions over one per table.
- Ask before deploying, and leave sign-in to the user.

Every command below is the TypeScript CLI, `npx hypequery …`. Python projects
use it too, through npx with the analysis engine alongside it (Node.js 20+):

```bash
npx -y -p @hypequery/cli -p @hypequery/onboard-engine hypequery onboard analyze --json
```

Read that form wherever a step says `npx hypequery` in a Python project. Add
`--json` to read results as data: one JSON document on stdout, logs on
stderr. Exit code 1 means something to correct (the `hint` says what), 4 means
retry. The commands never prompt under `--json`.

## 1. Check setup

- ClickHouse settings: `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`,
  `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD` in the environment or `.env`.
  Ask the user for missing values; never print the password.
- TypeScript: `npm i -D @hypequery/onboard-engine` (the analysis engine, loaded
  at runtime) and `npm i @hypequery/clickhouse @hypequery/datasets`.
  Python: `pip install hypequery`.
- `ONBOARD_ENGINE_MISSING` or `ONBOARD_ENGINE_INCOMPATIBLE`: the engine isn't
  installed in a supported version; run the command in the hint.
- `CONNECTION_FAILED` or `CLICKHOUSE_ACCESS_DENIED`: fix the connection with the
  user before going on.

## 2. Analyse

```bash
npx hypequery schema inspect --json     # tables, columns, engine metadata
npx hypequery onboard analyze --json    # the evidence for the model
```

From `onboard analyze`, read:

- `findings` and `questions`: traps such as aggregate-state tables, versioned
  rows (`ReplacingMergeTree` needs row resolution), status columns, mixed
  scales. Questions with `askBeforeDraft: true` change a number: ask them.
- `grainChecks`: what one row means, and duplicates.
- `joinCandidates`: measured relationships (`proposed` ones are candidates, not
  facts; confirm with the user before modelling them).
- `columnRoles`: likely time, status, currency and key columns.
- `queryHistory`: which tables, joins and filters existing queries use.
  `skipped` with a `QUERY_HISTORY_UNAVAILABLE` warning is fine; mention the
  grant in the hint once and move on.
- `connection.risks` / `profileFix`: tell the user if the ClickHouse user can
  write or has no limits.
- `tenantKeyCandidates`: questions for step 5.

Save what you will rely on in `analytics/onboarding/state.json` (tables chosen,
answers, check status) so a later session can resume. Commit it.

## 3. Choose tables

Show the user the tables with row counts and what each seems to hold. Ask which
ones matter. Don't model staging, backup or materialized-view source tables
unless asked; prefer the table that holds the facts the questions need.

## 4. Ask the business questions

Ask which questions people should be able to answer ("revenue by plan per
month", "active users by country"). Each question names measures (revenue,
active users), dimensions (plan, country) and a time grain. Write them down.

## 5. Ask about tenancy

Ask: "Do your customers each see only their own data? If so, which column
identifies the customer in each table?" Show `tenantKeyCandidates` as options,
plus "none". Record the answer word for word. Set a tenant key only for tables
the user named a column for.

## 6. Write the plan

Write `analytics/onboarding/plan.md`: tables, each question with the measure,
dimensions and grain that answer it, the tenancy answer verbatim, the answers
to `questions`, and joins the user confirmed. Show it and get a yes.

## 7–8. Write the datasets

Generate a starting point, then edit it to the plan:

- TypeScript: `npx hypequery generate:datasets --tables orders,customers`
  writes `analytics/datasets.ts`. Add `--tenant-column <column>` only with the
  column the user named.
- Python: `hypequery generate datasets` writes `datasets.py` (or write it by hand).

Then edit: rename fields to the product's language, delete meaningless
measures (sums of ids), add `description` to every dataset, dimension and
measure, set `timeKey`, add confirmed relationships (`belongsTo`), and handle
each finding (for example row resolution for versioned tables). The
`hypequery-datasets` skill has the API.

```ts
// analytics/datasets.ts
import { belongsTo, dataset, dimension, measure } from '@hypequery/datasets';

export const Customers = dataset('customers', {
  source: 'customers',
  description: 'One row per customer account.',
  dimensions: { id: dimension.number(), plan: dimension.string({ description: 'Billing plan' }) },
  measures: { customers: measure.count('id', { description: 'Customer accounts' }) },
});

export const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  // tenantKey: 'account_id',   // only if the user named this column
  description: 'Paid and refunded orders.',
  dimensions: { customer_id: dimension.number(), createdAt: dimension.timestamp({ column: 'created_at' }) },
  measures: { revenue: measure.sum('amount', { description: 'Order value in USD' }) },
  relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }) },
});
```

Python projects check a deployment bundle, written with the SDK next to
`datasets.py`:

```python
# hypequery_bundle.py
from hypequery.datasets import create_dataset_registry, write_dataset_bundle

from datasets import customers, orders

write_dataset_bundle("analytics/hypequery-deployment", create_dataset_registry(orders, customers))
```

Run `python hypequery_bundle.py` after each edit, deleting
`analytics/hypequery-deployment` first (it refuses to replace a bundle).

## 9. Check until clean

```bash
npx tsc --noEmit                                         # TypeScript: datasets typecheck
npx hypequery onboard check analytics/datasets.ts --json # TypeScript
npx hypequery onboard check analytics/hypequery-deployment --json   # Python bundle
```

`onboard check` runs every measure through an independent second route and
measures each declared relationship (add `--join child.col=parent.col` for
others). Exit 1 with `ONBOARD_CHECK_FAILED` lists each problem in
`error.issues`: fix the dataset (wrong column, missing row resolution, a join
that fans out) or ask the user where the data is ambiguous, then rerun.
`skipped` checks are not failures, but say which numbers were not verified.
Then answer each business question once through the datasets, not SQL (a short
script calling `analytics.execute(...)` or `client.execute(...)`, or
`npx hypequery mcp` with the `hypequery-query` skill when the project serves an
API), and show the user the numbers.

When a hint doesn't fix a failure, tell the user what you tried; don't loop.

## 10. Optional: deploy and connect

Only when the user wants hypequery Cloud:

1. `npx hypequery login`: the user approves sign-in in their browser. It needs
   a person; run it in their terminal, or use `HYPEQUERY_API_TOKEN` with
   `--endpoint` in CI.
2. TypeScript: export a publication and deploy it. Ask which roles and scopes
   may query it.

   ```ts
   // analytics/cloud.ts
   import { publishToCloud } from '@hypequery/datasets';
   import { Customers, Orders } from './datasets';
   export const cloud = publishToCloud({ datasets: { Orders, Customers }, access: { roles: ['analyst'], scopes: [] } });
   ```

   ```bash
   npx hypequery deploy analytics/cloud.ts --mcp-config
   ```

   Python: write the bundle with `endpoints=` (see
   https://hypequery.com/docs/cloud/deploy-python), then
   `npx hypequery deployment:release analytics/hypequery-deployment` and
   `npx hypequery deployment:submit analytics/hypequery-deployment --release analytics/hypequery-deployment.release.json`.
3. `npx hypequery deployment:status --mcp-config` prints the hosted MCP URL and
   the client configuration to give the user.

Docs: https://hypequery.com/docs/reference/api/cli (all commands, exit codes and
error codes) and https://hypequery.com/llms.txt.
