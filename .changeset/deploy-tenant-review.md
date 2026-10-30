---
"@hypequery/cli": patch
---

`hypequery deploy` and `deployment:build` warn when a served dataset has a customer-like column (`tenant_id`, `org_id`, `organization_id`, `organisation_id`, `account_id`, `customer_id`, `workspace_id` or `company_id`) in a dimension, measure or filter, and neither the dataset nor its endpoint is scoped by tenant. Without that, every caller can read every customer's rows. The warning names the `tenantKey` line to add, or says to mark the dataset shared in Cloud. The `cloud.ts` scaffold now explains what empty roles and scopes allow.
