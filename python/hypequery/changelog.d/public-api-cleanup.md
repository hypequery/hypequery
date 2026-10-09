- **Breaking (pre-release):** every authoring helper now lives in exactly one
  namespace: `dimension.*`, `measure.*`, `filter.*`, `order.*` and the new
  `formula.*` (`formula.divide`, `formula.null_if_zero`, `formula.round`, …).
  `hypequery.datasets` no longer re-exports the loose helpers. That covers the
  aggregations (`sum`, `count`, `min`, `max`, …), the filters (`eq`, `in_list`, …),
  the orderings (`asc`, `desc`) and the formula functions (`divide`, `round`, …).
  The package no longer shadows Python builtins such as `sum`, `min`, `max` and
  `round`. Write `measure.sum("amount")`, `filter.eq("status", "paid")`,
  `order.desc("revenue")` and `measure.derived(formula.divide("a", "b"))`.
- **Breaking (pre-release):** `hypequery.serve.validate_correlation_id` is now
  `sanitize_correlation_id`. The new name says it returns the caller's id or `None`
  instead of raising. It no longer shares a name with the planner's
  `validate_correlation_id`, which raises.
- `create_api` and `start_server` are now the definitions, matching TypeScript, and
  their error messages use those names. `create_router` and `run_production` remain
  as aliases.
