---
"@hypequery/cli": patch
---

`hypequery deploy` and `deployment:build` warn when a published dataset has a customer-like column (`tenant_id`, `organization_id`, `org_id`, `account_id` or `customer_id`) but no `tenantKey`, which means every caller can read every customer's rows. The warning names the `tenantKey` line to add. The `cloud.ts` scaffold now explains what empty roles and scopes allow.
