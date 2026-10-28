---
'@hypequery/protocol': minor
'@hypequery/protocol-conformance': minor
'@hypequery/datasets': minor
'@hypequery/deployment': minor
'@hypequery/serve': minor
'@hypequery/mcp': minor
'@hypequery/cli': minor
---

Add `isNull` and `isNotNull` comparisons, which take no value (RFC 0023), so
"has a churn date" is `churned_at IS NOT NULL` rather than a sentinel range. A
protocol comparison using one is `{ kind: 'comparison', operator: 'isNotNull',
left }` with no `right`; a client query filter is `{ field, operator: 'isNull' }`
with no `value`. Validators reject a value on them and accept any field type.
Measure fixed filters and segments can use them directly, including through the
new `isNull(field)` and `isNotNull(field)` helpers (also re-exported by
`@hypequery/serve`). Caller query filters are opt-in: a filter allows them only
when its `operators` list names them, so default operator lists, and the
identity of every existing deployment and client contract, are unchanged. The
deployment data plane, the MCP dataset guide and the generated client input
types support them, and the conformance corpus pins the new cases. Upgrade
every consumer before publishing a contract that uses them: earlier validators
reject the new operators.
