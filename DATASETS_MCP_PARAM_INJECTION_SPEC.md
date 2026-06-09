# ClickHouse Native Parameter Injection for Datasets & MCP

## Executive Summary

**Goal**: Migrate all dataset and MCP query execution to use ClickHouse native parameter injection (`query_params`) instead of string escaping for filter values and semantic expression literals.

**Current Status**:
- ✅ Query builder path (base metrics, dataset queries): Already uses native parameters
- ⚠️ Filtered aggregations: Uses string escaping via `renderLiteral()`
- ⚠️ Semantic expression literals: Uses string escaping via `renderLiteral()`
- ✅ MCP server: Already safe (uses query builder path)
- ✅ In-memory backend: Already safe (no SQL generation)

**Impact**:
- **Pre-release status**: This is the right time to make breaking changes
- **Security**: Eliminates remaining SQL injection risks in filtered aggregations
- **Performance**: Enables query plan caching for semantic queries
- **Consistency**: All code paths use the same parameter binding mechanism

---

## Current Architecture Analysis

### Safe Paths (Already Using Native Parameters)

#### 1. Base Metric Filters
**Location**: `/packages/datasets/src/executor.ts:375-389`
```typescript
for (const filter of query.filters ?? []) {
  const resolvedField = resolveFilterField(ds, filter.field);
  qb = qb.where(resolvedField, filter.operator, filter.value);  // ✓ SAFE
}
```
- Passes through query builder's `.where()` method
- Values handled as `ValueNode` objects
- Formatted as `{param_N:Type}` by SQL formatter
- **No changes needed**

#### 2. Dataset Query Filters
**Location**: `/packages/datasets/src/dataset-query.ts:79-82`
```typescript
for (const filter of query.filters ?? []) {
  const resolvedField = resolveFilterField(ds, filter.field);
  qb = qb.where(resolvedField, filter.operator, filter.value);  // ✓ SAFE
}
```
- Same safe path as base metrics
- **No changes needed**

#### 3. MCP Server Queries
**Location**: `/packages/mcp-server/src/tools/query-metric.ts`, `query-dataset.ts`
- Delegates to `DatasetClient.execute()`
- Flows through executor.ts → query builder path
- **No changes needed**

### Unsafe Paths (Need Migration)

#### 1. Filtered Aggregation Values (PRIORITY 1)
**Location**: `/packages/clickhouse/src/datasets.ts:112-148`

**Current Implementation**:
```typescript
function renderLiteral(value: string | number | boolean | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;  // String escaping
}

function renderFilterCondition(filter: MetricFilter): string {
  const field = filter.column;
  const value = renderLiteral(filter.value);
  return `${field} = ${value}`;  // Direct string embedding
}
```

**Example SQL Generated**:
```sql
-- Current (string escaping):
SUM(if(status = 'completed', amount, 0)) AS completed_revenue

-- Should be (native parameters):
SUM(if(status = {param_0:String}, amount, 0)) AS completed_revenue
-- Parameters: ['completed']
```

**Affected Code Paths**:
- `renderFilteredAggregationField()` (line 164)
- `buildBaseSQL()` (line 244) - aggregation filters in CTE
- `buildDerivedSQL()` (line 373) - outer query construction

**Migration Strategy**: See Section 3 below

#### 2. Semantic Expression Literals (PRIORITY 2)
**Location**: `/packages/clickhouse/src/datasets.ts:179-226`

**Current Implementation**:
```typescript
function renderExpression(expression: Expression): string {
  switch (expression.kind) {
    case 'literal':
      return renderLiteral(expression.value);  // String escaping
    case 'field':
      return quoteSQLIdentifier(expression.field);
    case 'binaryOp':
      const left = renderExpression(expression.left);
      const right = renderExpression(expression.right);
      return `(${left} ${expression.operator} ${right})`;
    // ... more cases
  }
}
```

**Example SQL Generated**:
```sql
-- Current formula: revenue_per_order = revenue / order_count
-- If revenue defined as: if(status = 'completed', amount, 0)
-- Generates: if(status = 'completed', amount, 0) / order_count

-- Should be:
if(status = {param_0:String}, amount, 0) / order_count
-- Parameters: ['completed']
```

**Migration Strategy**: See Section 3 below

---

## Migration Plan

### Phase 1: Filtered Aggregations (datasets.ts)

#### Changes Required

**File**: `/packages/clickhouse/src/datasets.ts`

**1. Create Parameter Context**
```typescript
interface ParameterContext {
  params: unknown[];
  addParam(value: unknown): string;  // Returns {param_N:Type}
}

function createParameterContext(): ParameterContext {
  const params: unknown[] = [];
  let counter = 0;

  return {
    params,
    addParam(value: unknown): string {
      params.push(value);
      const paramName = `param_${counter++}`;
      const paramType = inferClickHouseType(value);
      return `{${paramName}:${paramType}}`;
    }
  };
}
```

**2. Update renderFilterCondition**
```typescript
// BEFORE
function renderFilterCondition(filter: MetricFilter): string {
  const field = filter.column;
  const value = renderLiteral(filter.value);
  return `${field} = ${value}`;
}

// AFTER
function renderFilterCondition(filter: MetricFilter, ctx: ParameterContext): string {
  const field = filter.column;

  if (filter.operator === 'eq') {
    const placeholder = ctx.addParam(filter.value);
    return `${field} = ${placeholder}`;
  }

  if (filter.operator === 'in') {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    const placeholders = values.map(v => ctx.addParam(v)).join(', ');
    return `${field} IN (${placeholders})`;
  }

  // Add other operators as needed
  throw new Error(`Unsupported filter operator in aggregation: ${filter.operator}`);
}
```

**3. Update renderFilteredAggregationField**
```typescript
// BEFORE
function renderFilteredAggregationField(
  aggregation: string,
  column: string,
  filters: MetricFilter[]
): string {
  const conditions = filters.map(f => renderFilterCondition(f)).join(' AND ');
  return `${aggregation}(if(${conditions}, ${column}, 0))`;
}

// AFTER
function renderFilteredAggregationField(
  aggregation: string,
  column: string,
  filters: MetricFilter[],
  ctx: ParameterContext
): string {
  const conditions = filters.map(f => renderFilterCondition(f, ctx)).join(' AND ');
  return `${aggregation}(if(${conditions}, ${column}, 0))`;
}
```

**4. Update buildBaseSQL signature**
```typescript
// BEFORE
function buildBaseSQL(
  tableName: string,
  dimensions: readonly DatasetDimension[],
  measures: readonly DatasetMeasure[]
): string;

// AFTER
function buildBaseSQL(
  tableName: string,
  dimensions: readonly DatasetDimension[],
  measures: readonly DatasetMeasure[],
  ctx: ParameterContext
): string;
```

**5. Thread ParameterContext through call chain**
```typescript
// In execute() method (line 354)
const ctx = createParameterContext();

// Base metrics path
const baseSQL = buildBaseSQL(ds.sourceTable, ds.dimensions, baseMeasures, ctx);
const baseData = await queryBuilder.rawQuery<T>(baseSQL, ctx.params);

// Derived metrics path
const derivedSQL = buildDerivedSQL(ds, plan, ctx);
const data = await queryBuilder.rawQuery<T>(derivedSQL, ctx.params);
```

**6. Import type inference utility**
```typescript
import { inferClickHouseType } from './core/utils/type-inference.js';
```

#### Testing Strategy

**File**: `/packages/clickhouse/src/datasets.test.ts` (new file)

```typescript
import { describe, it, expect } from 'vitest';
import { ClickHouseSemanticBackend } from './datasets.js';

describe('Filtered Aggregations with Native Parameters', () => {
  it('should generate typed placeholders for string filter values', async () => {
    const ds = {
      name: 'orders',
      sourceTable: 'orders',
      dimensions: [{ name: 'country', expression: 'country' }],
      measures: [
        {
          name: 'completed_revenue',
          aggregation: 'sum',
          column: 'amount',
          filters: [{ column: 'status', operator: 'eq', value: 'completed' }]
        }
      ]
    };

    // Execute and capture SQL
    const backend = new ClickHouseSemanticBackend(mockAdapter);
    const result = await backend.execute(ds, {
      dimensions: ['country'],
      measures: ['completed_revenue']
    });

    // Verify SQL contains typed placeholder
    expect(result.sql).toContain('{param_0:String}');
    expect(result.sql).toContain("SUM(if(status = {param_0:String}, amount, 0))");
    expect(result.parameters).toEqual(['completed']);
  });

  it('should generate typed placeholders for IN operator', async () => {
    const ds = {
      name: 'orders',
      sourceTable: 'orders',
      dimensions: [{ name: 'country', expression: 'country' }],
      measures: [
        {
          name: 'active_revenue',
          aggregation: 'sum',
          column: 'amount',
          filters: [{ column: 'status', operator: 'in', value: ['pending', 'processing'] }]
        }
      ]
    };

    const backend = new ClickHouseSemanticBackend(mockAdapter);
    const result = await backend.execute(ds, {
      dimensions: ['country'],
      measures: ['active_revenue']
    });

    expect(result.sql).toContain('{param_0:String}');
    expect(result.sql).toContain('{param_1:String}');
    expect(result.parameters).toEqual(['pending', 'processing']);
  });

  it('should handle multiple filtered metrics', async () => {
    const ds = {
      name: 'orders',
      sourceTable: 'orders',
      dimensions: [{ name: 'country', expression: 'country' }],
      measures: [
        {
          name: 'completed_revenue',
          aggregation: 'sum',
          column: 'amount',
          filters: [{ column: 'status', operator: 'eq', value: 'completed' }]
        },
        {
          name: 'pending_revenue',
          aggregation: 'sum',
          column: 'amount',
          filters: [{ column: 'status', operator: 'eq', value: 'pending' }]
        }
      ]
    };

    const backend = new ClickHouseSemanticBackend(mockAdapter);
    const result = await backend.execute(ds, {
      dimensions: ['country'],
      measures: ['completed_revenue', 'pending_revenue']
    });

    expect(result.parameters).toEqual(['completed', 'pending']);
  });
});
```

---

### Phase 2: Semantic Expression Literals

#### Changes Required

**File**: `/packages/clickhouse/src/datasets.ts`

**1. Update renderExpression signature**
```typescript
// BEFORE
function renderExpression(expression: Expression): string;

// AFTER
function renderExpression(expression: Expression, ctx: ParameterContext): string;
```

**2. Update literal case**
```typescript
function renderExpression(expression: Expression, ctx: ParameterContext): string {
  switch (expression.kind) {
    case 'literal':
      // BEFORE: return renderLiteral(expression.value);
      // AFTER:
      return ctx.addParam(expression.value);

    case 'field':
      return quoteSQLIdentifier(expression.field);

    case 'binaryOp':
      const left = renderExpression(expression.left, ctx);
      const right = renderExpression(expression.right, ctx);
      return `(${left} ${expression.operator} ${right})`;

    case 'functionCall':
      const args = expression.args.map(arg => renderExpression(arg, ctx)).join(', ');
      return `${expression.function}(${args})`;

    // ... other cases
  }
}
```

**3. Thread ParameterContext through derived metric SQL builder**
```typescript
// In buildDerivedSQL
function buildDerivedSQL(
  ds: Dataset,
  plan: QueryPlan,
  ctx: ParameterContext
): string {
  // Build CTE with base metrics (already using ctx from Phase 1)
  const cteName = 'base';
  const baseSQL = buildBaseSQL(ds.sourceTable, ds.dimensions, baseMeasures, ctx);

  // Build derived metric expressions
  const derivedExpressions = derivedMeasures.map(measure => {
    const expr = renderExpression(measure.expression, ctx);  // Pass ctx
    return `${expr} AS ${quoteSQLIdentifier(measure.name)}`;
  });

  // Rest of SQL building...
}
```

#### Testing Strategy

```typescript
describe('Semantic Expression Literals with Native Parameters', () => {
  it('should generate typed placeholders for literals in formulas', async () => {
    const ds = {
      name: 'orders',
      sourceTable: 'orders',
      dimensions: [{ name: 'country', expression: 'country' }],
      measures: [
        {
          name: 'revenue',
          aggregation: 'sum',
          column: 'amount'
        },
        {
          name: 'revenue_with_tax',
          expression: {
            kind: 'binaryOp',
            operator: '*',
            left: { kind: 'field', field: 'revenue' },
            right: { kind: 'literal', value: 1.2 }  // 20% tax
          }
        }
      ]
    };

    const backend = new ClickHouseSemanticBackend(mockAdapter);
    const result = await backend.execute(ds, {
      dimensions: ['country'],
      measures: ['revenue_with_tax']
    });

    expect(result.sql).toContain('{param_0:Float64}');
    expect(result.parameters).toContain(1.2);
  });
});
```

---

### Phase 3: Remove Legacy String Escaping (BREAKING)

**File**: `/packages/clickhouse/src/core/utils.ts`

#### Option A: Mark as Deprecated
```typescript
/**
 * @deprecated This function is deprecated and should not be used for query parameters.
 * Use the query builder's native parameter binding instead.
 * This is kept only for backward compatibility with display/logging use cases.
 */
export function escapeValue(value: any): string {
  // ... existing implementation
}

/**
 * @deprecated Use native parameter binding via the adapter's query() method instead.
 * This is kept only for backward compatibility with display/logging use cases.
 */
export function substituteParameters(sql: string, params: any[]): string {
  // ... existing implementation
}
```

#### Option B: Remove Entirely (v4.0.0)
```typescript
// Remove functions entirely
// Update all logging/display code to use adapter.render() instead
```

**Migration Path for Consumers**:
```typescript
// BEFORE (v2.x)
import { escapeValue } from '@hypequery/clickhouse';
const sql = `SELECT * FROM users WHERE name = ${escapeValue(userName)}`;

// AFTER (v3.x+)
import { QueryBuilder } from '@hypequery/clickhouse';
const qb = new QueryBuilder({ tableName: 'users' });
const query = qb.where('name', 'eq', userName);
const { sql, params } = query.toSQLWithParams();  // Use native parameters
```

---

## Implementation Checklist

### Phase 1: Filtered Aggregations
- [ ] Create `ParameterContext` interface and `createParameterContext()` function
- [ ] Update `renderFilterCondition()` to accept `ParameterContext` and use `addParam()`
- [ ] Update `renderFilteredAggregationField()` to pass `ParameterContext`
- [ ] Update `buildBaseSQL()` signature to accept `ParameterContext`
- [ ] Thread `ParameterContext` through `execute()` method
- [ ] Import `inferClickHouseType` from type-inference utility
- [ ] Write tests for filtered aggregations
- [ ] Verify all dataset tests pass

### Phase 2: Semantic Expression Literals
- [ ] Update `renderExpression()` signature to accept `ParameterContext`
- [ ] Update literal case to use `ctx.addParam()`
- [ ] Update all recursive calls to pass `ParameterContext`
- [ ] Thread `ParameterContext` through `buildDerivedSQL()`
- [ ] Write tests for semantic expressions
- [ ] Verify all semantic tests pass

### Phase 3: Legacy Cleanup
- [ ] Mark `escapeValue()` and `substituteParameters()` as deprecated
- [ ] Update CHANGELOG with deprecation notice
- [ ] Add migration guide to documentation
- [ ] Plan for v4.0.0 removal (if desired)

### Testing & Validation
- [ ] Run full test suite: `pnpm --filter @hypequery/clickhouse test`
- [ ] Run dataset tests: `pnpm --filter @hypequery/datasets test`
- [ ] Test MCP server end-to-end
- [ ] Verify no performance regressions
- [ ] Update integration tests

### Documentation
- [ ] Update CHANGELOG for v3.0.0
- [ ] Update README with new security guarantees
- [ ] Add migration guide for v2.x → v3.x
- [ ] Document parameter binding architecture

---

## Security Benefits

### Before (String Escaping)
```sql
-- Filtered aggregation
SUM(if(status = 'completed', amount, 0))

-- Risk: Escaping bugs could allow injection
-- Example vulnerable case (hypothetical):
--   value = "completed') OR 1=1 --"
--   Escaped: 'completed'') OR 1=1 --'
--   If escape bug: completed') OR 1=1 --
```

### After (Native Parameters)
```sql
-- Filtered aggregation
SUM(if(status = {param_0:String}, amount, 0))
-- Parameters: ['completed']

-- ClickHouse handles binding server-side
-- No way for user input to break out of parameter context
-- Type safety enforced by ClickHouse
```

### Key Improvements
1. **Server-side binding**: ClickHouse handles parameter substitution, not user code
2. **Type enforcement**: Parameters are typed (`String`, `Int64`, etc.)
3. **No escaping logic**: Eliminates entire class of escaping bugs
4. **Query plan caching**: ClickHouse can cache execution plans
5. **Audit trail**: Parameters are separate from SQL in logs

---

## Performance Impact

### Query Plan Caching

**Before (String Escaping)**:
```sql
-- Query 1
SELECT country, SUM(if(status = 'completed', amount, 0)) FROM orders GROUP BY country

-- Query 2 (different filter value)
SELECT country, SUM(if(status = 'pending', amount, 0)) FROM orders GROUP BY country

-- ClickHouse sees these as different queries → 2 separate query plans
```

**After (Native Parameters)**:
```sql
-- Query 1
SELECT country, SUM(if(status = {param_0:String}, amount, 0)) FROM orders GROUP BY country
-- Parameters: ['completed']

-- Query 2
SELECT country, SUM(if(status = {param_0:String}, amount, 0)) FROM orders GROUP BY country
-- Parameters: ['pending']

-- ClickHouse sees identical SQL → reuses query plan → faster execution
```

**Expected Performance Gain**: 10-30% for repeated query patterns

---

## MCP Server Impact

### Current State
The MCP server already uses native parameters because it delegates to the datasets executor, which uses the query builder path.

### After Migration
No changes needed to MCP server code. The migration happens transparently in the datasets backend.

### Security Validation
```typescript
// MCP tool flow (no changes)
User Input → Zod Validation → DatasetClient.execute()
  → Query Builder (native params) → ClickHouse Adapter (query_params)

// After Phase 1 & 2
User Input → Zod Validation → DatasetClient.execute()
  → Query Builder OR Filtered Aggregations (both use native params)
  → ClickHouse Adapter (query_params)
```

**Result**: All MCP queries will use native parameter binding with zero code changes.

---

## Rollback Plan

If issues are discovered after deployment:

1. **Revert commits** related to filtered aggregation parameter binding
2. **Keep core native parameter work** (query builder path already stable)
3. **Document known issues** and plan fixes

**Risk Assessment**: LOW
- Query builder path already tested and stable
- Filtered aggregations are internal implementation details
- No API changes for end users
- Comprehensive test coverage catches issues early

---

## Timeline Recommendation

**Phase 1**: 1-2 days
- Implement filtered aggregation parameter binding
- Write tests
- Validate with existing datasets

**Phase 2**: 1 day
- Implement semantic expression parameter binding
- Write tests
- Validate with derived metrics

**Phase 3**: 1 day
- Mark legacy functions as deprecated
- Update documentation
- Write migration guide

**Total Estimated Time**: 3-4 days

**Recommended Release**: v3.0.0 (pre-release, so breaking changes acceptable)

---

## Questions for Review

1. Should we remove `escapeValue()` entirely in v3.0.0 or deprecate it?
2. Do we need to support any legacy use cases for string escaping?
3. Should we add a feature flag to toggle between string escaping and native params during migration?
4. What's the testing strategy for existing datasets in production?

---

## References

- Native Parameter Binding Implementation: `/packages/clickhouse/src/core/adapters/clickhouse-adapter.ts`
- Type Inference Utility: `/packages/clickhouse/src/core/utils/type-inference.ts`
- SQL Formatter: `/packages/clickhouse/src/core/formatters/sql-formatter.ts`
- Datasets Backend: `/packages/clickhouse/src/datasets.ts`
- Dataset Executor: `/packages/datasets/src/executor.ts`
- MCP Server: `/packages/mcp-server/src/server.ts`
