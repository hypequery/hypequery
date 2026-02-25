# Strategic Positioning Plan: Hypequery Builder-First Strategy

## Executive Summary

**Problem:** Homepage leads with `@hypequery/serve` (low adoption) instead of `@hypequery/clickhouse` builder (1,000 downloads/week, proven PMF)

**Strategic Pivot:** Lead with builder (the proven wedge), create clear progressive journey to serve (platform features), optimize for self-serve adoption

**Goal:** User growth + product-market fit validation over next 6 months

**Key Insight:** Builder is the adoption wedge; serve is the monetization expansion path. They share 100% compatible APIs, making migration seamless.

---

## Why This Pivot? (The Reasoning)

### Evidence:

1. **Download Disparity**: Builder gets 1,000 downloads/week; serve adoption is "materially lower"
2. **API Compatibility**: Both packages use identical query syntax - zero migration friction
3. **Feature Maturity**: Builder is v1.5.0 (stable); serve is v0.1.1 (early-stage)
4. **Market Reality**: Type-safe query building is the immediate pain point; HTTP governance is a scaling concern

### The Wedge Strategy:
- **Builder** = Solves immediate pain ("I need type-safe ClickHouse queries")
- **Serve** = Solves scaling pain ("I need governance, auth, multi-tenancy")

Most users start with the immediate pain. Only when they scale do they need governance. By leading with serve, you're asking users to adopt complexity they don't need yet.

### Real-World User Journey:
```
Solo Dev/Small Team → "I just need type-safe queries" → Builder
          ↓
Team Grows → "We need API governance" → Serve
          ↓
Enterprise → "We need advanced compliance" → Monetization
```

---

## Phase 1: Quick Wins (Weeks 1-2)

### 1. Homepage Repositioning

**File: `/website-next/src/app/page.tsx`**

**Changes:**
- Hero headline: "The Type-Safe Query Builder for ClickHouse" (currently: "The Analytics Backend for ClickHouse Teams")
- Subheadline: "Ship analytics across your entire stack with type-safe ClickHouse queries. Start simple, add governance when you scale."
- Add "30-Second Quick Start" with builder code example (currently shows serve `initServe`)
- Social proof badge: "1,000+ weekly downloads" (above hero)
- Add "Start Simple, Scale When Ready" section showing progression:
  ```
  Builder (Free) → Serve (When you need teams) → Enterprise (When you need compliance)
  ```

**Why:** Builder is the proven wedge. Homepage should lead with strongest value proposition.

---

### 2. Navigation Updates

**File: `/website-next/src/components/Navigation.tsx`**

**Changes:**
- Add "Query Builder" as top-level nav item (links to `/docs/standalone-query-builder/quick-start`)
- Keep "Documentation" but reorganize sidebar (see below)

**Why:** Make builder discoverable without digging through docs.

---

### 3. Documentation Sidebar Reorganization

**File: `/website-next/docs/meta.json`**

**New Order:**
```json
{
  "docs": [
    { "title": "Getting Started", "items": [
      "Introduction",
      "Quick Start: Builder Basics",         // NEW - builder-first
      "Choose Your Path: Builder vs Serve",  // MOVED UP - decision framework
      "Installation"
    ]},
    { "title": "Query Builder", "items": [
      "Core Concepts",
      "Building Queries",
      "Advanced Features",
      "When to Add Serve"                    // NEW - migration trigger
    ]},
    { "title": "Serve Framework (Optional)", "items": [
      "What is Serve?",
      "Quick Start: Serve Setup",            // RENAMED from "Quick Start"
      "Authentication",
      "Multi-Tenancy",
      "Migration Guide: Builder → Serve"     // NEW
    ]},
    // ... rest of docs
  ]
}
```

**Why:** Progressive complexity. Builder basics first, serve as advanced enhancement.

---

## Phase 2: Core Content Creation (Weeks 3-8)

### 1. New Builder-First Quick Start

**File: `/website-next/docs/quick-start-builder-first.mdx` (NEW)**

**Content:**
```markdown
# Quick Start: Builder Basics

## Get Started in 30 Seconds

\`\`\`bash
npm install @hypequery/clickhouse @clickhouse/client
\`\`\`

\`\`\`typescript
import { createQueryBuilder } from '@hypequery/clickhouse';

const db = createQueryBuilder({
  client: clickhouseClient,
});

const result = await db
  .table('users')
  .select(['name', 'email'])
  .where('created_at', 'gte', '2024-01-01')
  .execute();
\`\`\`

## What's Next?

**Building a dashboard?** → See Query Builder Guide
**Need an HTTP API?** → Check out Serve Framework
**Scaling with a team?** → See When to Add Serve
\```

**Why:** Fastest path to value. No overhead, just queries.

---

### 2. Enhanced Decision Framework

**File: `/website-next/docs/standalone-query-builder/when-to-use.mdx` (MAJOR UPDATE)**

**New Content Structure:**
```markdown
# Choose Your Path: Builder vs Serve

## Start with Builder if:
- ✅ You're building a dashboard or internal tool
- ✅ You need type-safe ClickHouse queries
- ✅ You're a solo developer or small team
- ✅ You want full control over query execution

## Add Serve if:
- 🚀 You need to expose queries as HTTP APIs
- 🚀 Your team needs governance and access controls
- 🚀 You're building multi-tenant SaaS applications
- 🚀 You want automatic OpenAPI documentation

## Comparison Table

| Feature | Builder | Serve |
|---------|---------|-------|
| Type-safe queries | ✅ | ✅ |
| Direct ClickHouse access | ✅ | ❌ |
| HTTP API generation | ❌ | ✅ |
| Authentication (RBAC) | ❌ | ✅ |
| Multi-tenancy | Manual | ✅ Auto |
| OpenAPI docs | ❌ | ✅ |

## Real-World Examples

**Example 1: E-commerce Dashboard (Builder)**
→ Single developer, internal analytics, no API needed

**Example 2: Multi-Tenant SaaS API (Serve)**
→ Team collaboration, customer-facing APIs, need governance

## Still Not Sure?

Start with **Builder**. You can migrate to Serve in 10 minutes when you're ready—no code changes needed.

See: [Migration Guide: Builder → Serve](/docs/migration-standalone-to-serve)
\```

**Why:** Clear decision framework reduces cognitive load. Default to builder (simpler).

---

### 3. Migration Guide

**File: `/website-next/docs/migration-standalone-to-serve.mdx` (NEW)**

**Content:**
```markdown
# Migrate from Builder to Serve

## Why Upgrade?

**You need Serve if:**
- Your team is growing and you need access controls
- You want to expose analytics as HTTP APIs
- You're building multi-tenant applications
- You need API documentation and governance

## Migration in 10 Minutes

### Before (Builder)
\`\`\`typescript
const db = createQueryBuilder({ client });

const result = await db
  .table('users')
  .where('active', true)
  .execute();
\`\`\`

### After (Serve)
\`\`\`typescript
const { define, query } = initServe({
  context: () => ({ db }),
  queries: queries({
    activeUsers: query
      .query(async ({ ctx }) => {
        return await ctx.db  // Same query syntax!
          .table('users')
          .where('active', true)
          .execute();
      })
  })
});
\`\`\`

### Key Changes:
1. Wrap queries with `initServe` and `define`
2. Add `.query()` wrapper
3. **Zero query changes** - same syntax!

## Next Steps

- [ ] Add authentication
- [ ] Enable multi-tenancy
- [ ] Set up OpenAPI docs

See: [Serve Quick Start](/docs/quick-start-serve)
\```

**Why:** Emphasize zero migration cost. Reduce fear of lock-in.

---

### 4. Serve Quick Start Renaming

**File: `/website-next/docs/quick-start.mdx` (RENAME → `quick-start-serve.mdx`)**

**Update:**
- Add banner at top: "New to Hypequery? Start with [Builder Quick Start](/docs/quick-start-builder-first)"
- Focus on users who already know they need HTTP APIs

**Why:** Clear routing for users who know they need serve.

---

## Phase 3: Optimization & Validation (Weeks 9-16)

### 1. Analytics Implementation

**Track These Metrics:**

**Funnel Metrics:**
- Homepage → Quick Start click-through rate
- Quick Start completion rate (scroll to bottom?)
- Path analysis: Builder docs → Serve docs?

**Engagement Metrics:**
- Time on page per doc
- Return visitors to docs
- GitHub stars (correlates with awareness)

**Conversion Metrics:**
- npm download growth (@hypequery/clickhouse vs @hypequery/serve)
- GitHub issues mentioning migration
- Social sentiment (mentions, feedback)

**Implementation:**
- Add Google Analytics or Plausible to website
- Track doc page views with UTM parameters
- npm download trends via npm-stats package

---

### 2. A/B Testing Framework

**File: `/website-next/src/lib/ab-testing.ts` (NEW)**

**Test Variations:**
- Hero headline: "Query Builder" vs "Analytics Backend"
- Quick start: Builder-first vs Serve-first
- CTA button: "Get Started" vs "Build Queries" vs "Read Docs"

**Success Metrics:**
- Click-through to documentation
- Time on documentation pages
- npm downloads (attribution via UTM)

---

### 3. Customer Research

**Interview Target:**
- 5 solo developers using standalone builder
- 5 users who considered serve but didn't adopt
- 5 users who migrated from builder to serve

**Questions:**
- What problem were you trying to solve?
- How did you choose between builder and serve?
- What's stopping you from upgrading to serve?
- What would make serve more compelling?

**Signals to Track:**
- GitHub issue themes
- Search queries (Google Search Console)
- Social media mentions
- Discord/community feedback

---

## Success Criteria

### Phase 1 (Week 2) - Engagement Baseline
- [ ] Homepage → docs click-through > 40%
- [ ] Average time on docs > 90 seconds
- [ ] Quick start page bounce rate < 70%

### Phase 2 (Week 8) - Adoption Signals
- [ ] 60%+ choose standalone path first (analytics)
- [ ] Migration guide viewed by 30%+ of builder doc visitors
- [ ] @hypequery/clickhouse npm downloads increasing > 10% MoM

### Phase 3 (Week 16) - PMF Validation
- [ ] 20%+ standalone → serve migration rate (within 90 days)
- [ ] Returning visitors to documentation > 25%
- [ ] GitHub star growth > 10% MoM
- [ ] Clear identification of top 2-3 use cases with strongest PMF

---

## Risk Mitigation

### Risk 1: Over-Positioning to Builder, Serve Adoption Stalls

**Mitigation:**
- Always show "What's Next" after builder basics
- Migration guide prominently linked throughout builder docs
- Add "Why upgrade" content at scaling pain points (e.g., "Building your first API? Consider Serve")
- Track standalone→serve conversion rate weekly

### Risk 2: Decision Paralysis (Users Can't Choose)

**Mitigation:**
- Default recommendation: "Start with Builder" (highlighted in decision guide)
- Progressive disclosure: Don't show serve complexity until builder basics mastered
- Clear trigger points: "Add serve when you need [X]"

### Risk 3: Documentation Fragmentation

**Mitigation:**
- Cross-link between builder and serve docs extensively
- Use consistent examples across both paths
- Migration guide linked from multiple entry points

---

## Implementation Priority Summary

### Immediate (Week 1-2):
1. Homepage repositioning (`/website-next/src/app/page.tsx`)
2. Docs sidebar reorganization (`/website-next/docs/meta.json`)
3. Update "when to use" guide with decision framework

### Short-term (Week 3-8):
4. Create builder-first quick start (`/website-next/docs/quick-start-builder-first.mdx`)
5. Create migration guide (`/website-next/docs/migration-standalone-to-serve.mdx`)
6. Rename and update serve quick start

### Medium-term (Week 9-16):
7. Implement analytics tracking
8. Conduct customer research interviews
9. Iterate based on data

---

## Long-Term Vision (Post-16 Weeks)

### If PMF Validated (Builder → Serve Conversion > 15%):
- **Double down** on builder as acquisition channel
- **Invest** in migration automation tools
- **Position** serve as "Team Governance Layer" (not competing with builder, complementing)

### If Serve Adoption Remains Low:
- **Pivot** to builder-first monetization (paid builder features? enterprise support?)
- **Explore** SaaS query inspector as lead-gen tool (deferred based on user feedback)
- **Consider** making serve fully open-source (remove monetization pressure, focus on adoption)

---

## Critical Files Reference

### Homepage & Navigation:
- `/website-next/src/app/page.tsx` - Hero, quick start, social proof
- `/website-next/src/components/Navigation.tsx` - Top-level nav structure

### Documentation Structure:
- `/website-next/docs/meta.json` - Sidebar organization (builder-first order)

### New Content Files:
- `/website-next/docs/quick-start-builder-first.mdx` - Builder-first onboarding
- `/website-next/docs/migration-standalone-to-serve.mdx` - Migration guide
- `/website-next/docs/standalone-query-builder/when-to-use.mdx` - Decision framework (update)

### Existing Content to Update:
- `/website-next/docs/quick-start.mdx` → Rename to `quick-start-serve.mdx`

### Analytics (New):
- `/website-next/src/lib/analytics.ts` - Tracking implementation
- `/website-next/src/lib/ab-testing.ts` - A/B testing framework

---

## Summary

**Strategic Shift:** Platform-first → Builder-first, with serve as natural expansion path

**Key Principle:** Progressive complexity. Start with immediate pain (type-safe queries), add governance when scaling (HTTP APIs, auth, multi-tenancy)

**Success Definition:** 1,000+ builder downloads/week → 20%+ migrate to serve → Clear monetization path through team features

**North Star:** Make Hypequery the easiest way to write type-safe ClickHouse queries, then make it the easiest way to govern those queries at scale.
