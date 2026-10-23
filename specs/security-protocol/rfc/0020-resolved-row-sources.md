# RFC 0020: Explicit resolved-row dataset sources

- Status: Proposed
- Version: source resolution 1

A dataset's `source` remains a physical identifier. Optional `rowResolution`
changes its row population; omission retains physical-row semantics. This field
is supported in dataset contracts and deployment versions 2 and 3. Older
implementations reject the unknown field; consumers must upgrade together rather
than strip it or silently fall back. It participates in deployment identity and
local semantic cache identity.

```json
{
  "source": "users",
  "rowResolution": {
    "kind": "final",
    "engine": "replacing",
    "deletedColumn": "is_deleted"
  }
}
```

`kind` must be `final`. `engine` is one of:

- `replacing`: ReplacingMergeTree or its replicated form. The table's own sorting
  key and version arguments select the latest row. Optional `deletedColumn` names
  a Boolean/0-or-1 deletion marker; only resolved rows equal to zero survive.
- `collapsing` or `versioned-collapsing`: corresponding CollapsingMergeTree family,
  including replicated forms. Required `signColumn` names the engine's sign column;
  only surviving positive rows are current state. Cancellation pairs resolve first.

Column names are portable identifiers. Unknown keys fail closed. Authors must
verify these engine families/columns against metadata; a policy is explicit
configuration, not engine detection. Version ties retain ClickHouse's own FINAL
semantics; this policy does not invent a deterministic tie-breaker. The engine's
sorting key defines identity, including any partition behavior the server uses.

The TypeScript ClickHouse planner resolves each physical source before measure,
dimension, tenant, segment and user filters. Target relationships use the same
resolved population before ANY JOIN or uniqueness checks. Derived/window/shift
scans share this source renderer. The source subquery disables automatic PREWHERE
movement so a deletion or mutable-dimension predicate cannot retain an older
version. See [ClickHouse's PREWHERE documentation](https://clickhouse.com/docs/reference/statements/select/prewhere).
These query-local safety settings require a read-only connection that permits
settings changes (`readonly=2`, or equivalent grants); `readonly=1` profiles may
refuse the query and must be adjusted. The planner never retries with raw rows.

SummingMergeTree and AggregatingMergeTree are deliberately unsupported by this
policy: FINAL merging does not turn aggregate states into ordinary scalar
measures. ArgMax source reconstruction, as-of history and general merge-state
measures remain separate extensions. Non-ClickHouse SQL dialects and the frozen
semantic-backend path reject a resolved-row dataset. Python validates/encodes the
portable policy but does not yet expose code-first dataset authoring for it.

Portable fixtures live in `fixtures/deployments-v2/`. Executable ClickHouse
reconciliation is in `packages/datasets/src/tests/integration/resolved-rows.test.ts`:
physical duplicate versions, soft deletion, mutable tenant/plan values, joined
targets, time scans, deployment rehydration, and both collapsing families.
