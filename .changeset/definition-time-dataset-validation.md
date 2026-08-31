---
"@hypequery/datasets": minor
---

Validate dataset definitions structurally when `dataset()` is called, instead of letting a malformed model fail on the first query that reaches the broken part of it. Datasets are normally defined at module scope, so an invalid one now fails at import — in the build, in CI, and in the first test that touches the module.

`source`, `tenantKey`, `timeKey`, dimension columns and measure fields are checked as SQL identifiers, since each is interpolated into generated SQL. `tenantKey` matters most: it becomes a predicate on every query against a tenant-scoped dataset, and a typo previously constructed cleanly.

Raw `sql` expressions on dimensions and measures are rejected when they carry a statement terminator or comment opener (`;`, `--`, `/*`), because the value is spliced into a larger expression. A declared `dependencies` entry the expression never references is also rejected — the definition would otherwise claim to read a column it does not read.

Dimension and measure names are checked as identifiers too, since they appear in query inputs, generated tool schemas, and protocol artifacts. Previously a name was only checked indirectly, via the column it defaulted to, so the same bad name passed or failed depending on whether an explicit `column` was set.

`limits` values must be positive integers.
