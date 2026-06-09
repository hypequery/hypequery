# v3.0.0 Roadmap - Later This Year

## Status: In Planning

**Target**: Q3/Q4 2026
**Theme**: Major Security, Performance & API Improvements

---

## Confirmed for v3.0.0

### 1. Native Parameter Binding ✅ READY
**Branch**: `feat/use-server-side-param-injection`
**Status**: Implemented, tested, documented
**Benefits**:
- Eliminates SQL injection attack surface entirely
- 10-30% performance improvement (query plan caching)
- Cleaner internal architecture

**Files ready**:
- All implementation code ✅
- 521 passing tests ✅
- DATASETS_MCP_PARAM_INJECTION_SPEC.md ✅
- Migration guide in CHANGELOG ✅

**Action when releasing v3**:
```bash
git checkout main
git merge feat/use-server-side-param-injection
# Then continue with other v3 changes...
```

---

## Candidates for v3.0.0

### Ideas to Consider

#### API Improvements
- [ ] Remove deprecated `getConfig()` (favor `getQueryNode()`)
- [ ] Stricter TypeScript types for filters
- [ ] Cleanup any other deprecated methods
- [ ] API consistency improvements

#### Performance
- [ ] Query builder optimizations
- [ ] Better type inference performance
- [ ] Memory optimizations for large result sets

#### Features That Require Breaking Changes
- [ ] Enhanced relationship API
- [ ] Better streaming API
- [ ] Improved error messages
- [ ] [Add others as you discover them]

#### Documentation
- [ ] Complete API reference
- [ ] Migration guide from v2 → v3
- [ ] Performance tuning guide
- [ ] Security best practices guide

---

## Between Now and v3.0.0

### What to Work On (v2.x releases)

**v2.1.x - v2.9.x**: Focus on non-breaking improvements
- New features (minor versions)
- Bug fixes (patch versions)
- Performance improvements (if non-breaking)
- Documentation improvements

### Accumulation Strategy

Keep a running list of "would be good for v3" items:
```markdown
# v3-candidates.md

## Breaking Changes Queue

- [ ] Native parameter binding (already implemented)
- [ ] Remove X deprecated feature (discovered DATE)
- [ ] Fix Y inconsistent API (discovered DATE)
- [ ] Improve Z typing (discovered DATE)
```

---

## When to Release v3.0.0

### Triggers

Release v3 when ONE of these is true:

1. **Enough breaking changes accumulated** (5+ substantial items)
2. **Major feature requires it** (new architecture, etc.)
3. **Scheduled milestone** (e.g., "end of Q3 2026")
4. **External pressure** (ClickHouse major version, dependency updates)

### Don't Release v3 If...

- Only 1-2 breaking changes
- Can work around with deprecations
- Would cause version churn perception

---

## Merge Strategy for v3

When ready to release v3.0.0:

```bash
# 1. Create v3 development branch
git checkout -b release/v3.0.0

# 2. Merge native params
git merge feat/use-server-side-param-injection

# 3. Implement other v3 breaking changes
# ... make other breaking changes ...

# 4. Update CHANGELOG.md with ALL v3 changes
# 5. Update migration guide
# 6. Run full test suite
pnpm test
pnpm test:integration

# 7. Merge to main
git checkout main
git merge release/v3.0.0

# 8. Publish
pnpm changeset version
pnpm changeset publish
```

---

## Communication Plan

### When Announcing v3

**Blog post / Release notes theme:**
> "v3.0.0: Security, Performance, and Developer Experience"

**Highlight bundle of improvements:**
- 🔒 Native parameter binding (security hardening)
- ⚡ Query plan caching (10-30% faster)
- 🎯 [Other features]
- 🧹 Cleaned up deprecated APIs
- 📚 Complete API documentation

**Make it feel substantial, not "just a SQL format change"**

---

## Maintenance Notes

### Keeping feat/use-server-side-param-injection Fresh

**Every month or so**:
```bash
git checkout feat/use-server-side-param-injection
git rebase main  # Keep up to date with main
git push --force-with-lease
```

**Or**: Just re-merge from main when ready for v3

### If You Need Native Params Earlier

If urgent need arises before v3:
1. Add `toSQLWithParamsLegacy()` method (0.5 days)
2. Ship as v2.x.0
3. Clean up in v3

---

## Pre-release Checklist (When Ready)

- [ ] Accumulated 5+ breaking changes
- [ ] All breaking changes implemented
- [ ] All tests passing (unit + integration)
- [ ] Migration guide complete
- [ ] Documentation updated
- [ ] Blog post drafted
- [ ] Announced in community channels
- [ ] Tested against real-world projects

---

## Current Status

**Ready for v3**:
- ✅ Native parameter binding (complete)

**Total breaking changes**: 1

**Recommendation**: Wait until 4-5 more items accumulated

**Estimated timeline**: Q3/Q4 2026 (6-9 months from now)
