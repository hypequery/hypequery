# Native ClickHouse Parameter Binding Implementation Plan

## Executive Summary

**Goal:** Replace string-based parameter substitution with ClickHouse native `query_params` for hardened security (eliminate escaping bugs).

**User Constraints:**
- Primary goal: Security hardening
- Backward compatibility: Can break if benefits are clear
- Timeline: Flexible (minor or major release depending on code churn)
- Control: Global config on connection OR forced opt-in

**Recommendation:** **Forced migration with global config flag** - Replace string substitution entirely in v3.0.0, with opt-in available in v2.x for early adopters.

---

## Recommended Approach: Breaking Change with Migration Path

### Why This Approach?

1. **Security First**: Eliminates entire class of escaping bugs - no more manual escaping logic
2. **Performance Bonus**: ClickHouse query plan caching (identical queries with different params reuse execution plans)
3. **Simpler Codebase**: Remove `escapeValue()` and `substituteParameters()` entirely
4. **Industry Standard**: Matches how PostgreSQL, MySQL, and other databases work
5. **User Accepted Breaking Changes**: User indicated willingness if benefits are clear

### Breaking Changes for Users

**None** - This is purely internal implementation. The query builder API remains identical:

```typescript
// User code - NO CHANGES REQUIRED
db.table('users')
  .where('id', 'eq', 42)
  .where('name', 'like', 'John%')
  .execute()
```

The change is **transparent** - only the underlying parameter handling changes, not the API surface.

---

## Implementation Checklist

- [ ] Create type inference utility (`src/core/utils/type-inference.ts`)
- [ ] Update SQLFormatter to generate named params with types
- [ ] Modify ClickHouseDialect to use new formatter output
- [ ] Update ClickHouseAdapter to use query_params
- [ ] Update CompiledQuery interface
- [ ] Add comprehensive tests
- [ ] Update CHANGELOG
- [ ] Verify all existing tests pass

---

## Critical Files to Modify

1. **`packages/clickhouse/src/core/dialects/clickhouse-dialect.ts`**
2. **`packages/clickhouse/src/core/formatters/sql-formatter.ts`**
3. **`packages/clickhouse/src/core/adapters/clickhouse-adapter.ts`**
4. **`packages/clickhouse/src/core/utils/type-inference.ts`** (NEW)
5. **`packages/clickhouse/src/types/index.ts`**
6. **`packages/clickhouse/src/core/utils.ts`**
7. **`packages/clickhouse/src/core/tests/native-params.test.ts`** (NEW)

For full details, see `/Users/lukereilly/.claude/plans/abundant-imagining-kay.md`
