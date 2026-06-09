# Is Native Parameter Binding Actually a Breaking Change?

## Breaking Change Analysis

### What Changed?

```typescript
// v2.0.2
query.toSQLWithParams()
// Returns: { sql: "WHERE id = ?", parameters: [42] }

// v2.1.0 (proposed)
query.toSQLWithParams()
// Returns: { sql: "WHERE id = {param_0:Int64}", parameters: [42] }
```

---

## Is `toSQLWithParams()` a User-Facing API?

### Current Documentation Status
- ❌ Not in README
- ❌ Not in public docs
- ❓ Unclear if intended for public use

### Actual Usage (grep results)

**Internal uses (within hypequery packages):**
1. `cache-manager.ts:84` - Cache key generation
2. `executor.ts` - Multiple internal calls
3. `datasets.ts` - Internal query building

**External uses (user code):**
- Unknown - would need to check production usage

---

## Scenarios Where This Breaks

### ❌ Scenario 1: SQL Logging/Monitoring
```typescript
// User code that parses SQL for monitoring
const { sql, parameters } = query.toSQLWithParams();

// Logs SQL with ? placeholders for monitoring dashboard
logger.logQuery(sql); // Expected: "WHERE id = ?"
                      // Got: "WHERE id = {param_0:Int64}" ⚠️
```

**Fix needed:** Update log parser

---

### ❌ Scenario 2: Query Building/Composition
```typescript
// User manually building SQL from query builder output
const { sql, parameters } = query.toSQLWithParams();

// Replace ? with actual values for some reason
const finalSQL = sql.replace(/\?/g, (match) => {
  return escapeValue(parameters.shift());
}); // Breaks! No ? to replace
```

**Fix needed:** Use `.toSQL()` instead (substitutes params automatically)

---

### ✅ Scenario 3: Normal Query Execution (NO BREAK)
```typescript
// This works identically
await query.execute(); // ✅ No change
await query.stream();  // ✅ No change

// Display SQL with substituted params
console.log(query.toSQL()); // ✅ Still works (params substituted for display)
```

---

## Options to Avoid v3.0.0

### Option A: Argue It's Not Breaking (Make it v2.1.0)

**Reasoning:**
1. `toSQLWithParams()` may not be documented public API
2. Execution behavior unchanged (main use case)
3. `toSQL()` behavior unchanged (display use case)
4. Only internal SQL format changed

**Precedent:** Many libraries consider internal format changes non-breaking

**Risk:** Users relying on SQL format get surprised

**Mitigation:**
```typescript
// Add to CHANGELOG for v2.1.0:

### Minor Changes

- **Internal**: SQL parameter binding now uses ClickHouse native `query_params` for
  enhanced security and performance. This is an internal change that doesn't affect
  the query builder API.

### Notes

- The format returned by `toSQLWithParams()` has changed from `?` placeholders to
  `{param_N:Type}` format. If you're parsing this output, please update your parser.
  This method is intended for debugging/inspection, not for programmatic SQL generation.
- For production query building, continue using `.execute()` or `.toSQL()`
```

**SemVer interpretation:**
- Is `toSQLWithParams()` output format part of the "public API"?
- If it's documented as "for debugging/inspection only" → NOT breaking
- If it's documented as stable output format → IS breaking

---

### Option B: Add `toSQLWithParamsLegacy()` Method (v2.1.0)

```typescript
class QueryBuilder {
  /**
   * Returns SQL with native parameter placeholders (recommended)
   */
  toSQLWithParams(): { sql: string, parameters: any[] } {
    const compiled = this.dialect.compileQuery(this.query, { tableName: this.tableName });
    return { sql: compiled.query, parameters: compiled.parameters };
    // Returns: { sql: "WHERE id = {param_0:Int64}", parameters: [42] }
  }

  /**
   * Returns SQL with ? placeholders (legacy, for backward compatibility)
   * @deprecated Will be removed in v3.0.0
   */
  toSQLWithParamsLegacy(): { sql: string, parameters: any[] } {
    const compiled = this.dialect.compileQuery(this.query, { tableName: this.tableName });
    // Convert {param_N:Type} back to ?
    const legacySQL = compiled.query.replace(/\{param_\d+:[^}]+\}/g, '?');
    return { sql: legacySQL, parameters: compiled.parameters };
    // Returns: { sql: "WHERE id = ?", parameters: [42] }
  }
}
```

**Effort:** 0.5 days
**Result:** Not breaking, clean deprecation path

---

### Option C: Keep v3.0.0 But Bundle More Breaking Changes

Make v3.0.0 more substantial by including other breaking changes you've been waiting to do:

**Possible inclusions:**
- Native parameter binding (this PR)
- Remove deprecated methods
- API improvements you've been postponing
- Type system improvements

**Example v3.0.0 feature list:**
```markdown
## v3.0.0 - Major Security & Performance Release

### Breaking Changes
1. Native parameter binding (security hardening)
2. Remove deprecated `getConfig()` (use `getQueryNode()`)
3. Stricter type checking for filters
4. [Other breaking changes you want to make]

### New Features
1. Query plan caching (10-30% faster)
2. Enhanced type inference
3. [New features]
```

**Benefit:** Makes v3 feel like a major release, not just a format change

---

### Option D: Delay This to Future v3.0.0

**Approach:**
- Keep current branch as `feat/native-params` (don't merge)
- Accumulate other breaking changes
- Release v3.0.0 in a few months with multiple breaking changes bundled

**Timeline:**
- Now: Continue with v2.x releases
- Later: Merge native params as part of bigger v3.0.0

**Benefit:** Avoids rapid version churn
**Cost:** Delay security improvement

---

## Recommendation Matrix

| Option | Version | Effort | Risk | User Perception |
|--------|---------|--------|------|-----------------|
| **A: Not breaking** | v2.1.0 | 0 days | Medium | ✅ Stable |
| **B: Add legacy method** | v2.1.0 | 0.5 days | Low | ✅ Smooth |
| **C: Bundle breaking changes** | v3.0.0 | Varies | Low | ✅ Substantial |
| **D: Delay to future v3** | v2.x | 0 days | Low | ✅ Patient |

---

## My New Recommendation: Option B

**Add `toSQLWithParamsLegacy()` and ship as v2.1.0**

### Implementation:

```typescript
// query-builder.ts

/**
 * Returns SQL with native ClickHouse parameter placeholders.
 * @returns Object with SQL containing {param_N:Type} placeholders and parameters array
 */
toSQLWithParams(): { sql: string, parameters: any[] } {
  return this.executor.toSQLWithParams();
}

/**
 * Returns SQL with legacy ? placeholders (for backward compatibility).
 * @deprecated Use toSQLWithParams() for native parameter binding. This method
 * will be removed in v3.0.0. If you need SQL for display, use toSQL() instead.
 */
toSQLWithParamsLegacy(): { sql: string, parameters: any[] } {
  const { sql, parameters } = this.executor.toSQLWithParams();
  // Convert {param_N:Type} to ?
  const legacySQL = sql.replace(/\{param_\d+:[^}]+\}/g, '?');
  return { sql: legacySQL, parameters };
}
```

### CHANGELOG:

```markdown
## v2.1.0

### Minor Changes

- Enhanced security: Query execution now uses ClickHouse native parameter binding
  (`query_params`) instead of string substitution. This eliminates an entire class
  of SQL injection vulnerabilities while maintaining full API compatibility.

### Deprecations

- `toSQLWithParams()` output format has changed from `?` placeholders to
  `{param_N:Type}` format for native parameter binding. If you need the legacy
  format, use the new `toSQLWithParamsLegacy()` method (deprecated, will be
  removed in v3.0.0).

### Migration Guide

**No changes required for 99% of users** - query execution works identically.

If you're parsing `toSQLWithParams()` output:
- Option 1: Update parser to handle `{param_N:Type}` format
- Option 2: Use `toSQLWithParamsLegacy()` temporarily (deprecated)
- Option 3: Use `toSQL()` if you need display-ready SQL
```

### Benefits:
1. ✅ Ship as v2.1.0 (minor, not major)
2. ✅ No breaking changes
3. ✅ Users get security improvements immediately
4. ✅ Clean deprecation path
5. ✅ Minimal additional code (just one method)

### Effort: 0.5 days

---

## Alternative: Argue It's Not Breaking At All

**Case for v2.1.0 without legacy method:**

From SemVer spec:
> "Bug fixes not affecting the API" → PATCH
> "Backwards compatible functionality" → MINOR
> "Incompatible API changes" → MAJOR

**Question:** Is `toSQLWithParams()` output format part of the API contract?

**Arguments for NO (make it v2.1.0):**
1. Method signature unchanged: `(): { sql: string, parameters: any[] }`
2. Method behavior unchanged: Returns SQL + params
3. Execution unchanged: `.execute()` works identically
4. Only internal SQL representation changed
5. Not documented as having stable SQL format

**Comparison:** Similar to React changing JSX transform output - not considered breaking

**Would need:**
- Clear note in CHANGELOG about format change
- Label it as "internal change"
- Document that toSQLWithParams() is for debugging only

---

## Decision Time

What do you prefer?

1. **Option B**: Add `toSQLWithParamsLegacy()`, ship as v2.1.0 (my recommendation)
   - Clean, safe, no breaking change

2. **Option A**: Ship as v2.1.0, argue not breaking
   - Cleaner code, but riskier

3. **Option C**: Bundle more breaking changes, make v3.0.0 substantial
   - What else should be in v3?

4. **Option D**: Delay native params to future v3
   - When would you want v3? What else goes in it?
