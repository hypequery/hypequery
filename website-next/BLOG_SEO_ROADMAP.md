# Blog SEO Roadmap

## Goal

Build topic authority around the overlap of:

- ClickHouse
- Type-safe analytics APIs
- Analytics architecture
- Semantic layer alternatives
- Multi-tenant product analytics

## Core clusters

### 1. ClickHouse Engineering

Hub:

- `/blog/topics/clickhouse`

Next articles:

- ClickHouse for product analytics: architecture patterns that survive production
- ClickHouse dashboard backend architecture for Next.js apps
- ClickHouse projections vs materialized views: when each wins
- Common ClickHouse mistakes in customer-facing analytics products

Primary links:

- `/docs/introduction`
- `/docs/observability`
- `/docs/quick-start`

### 2. Analytics APIs

Hub:

- `/blog/topics/analytics-api`

Next articles:

- How to build a type-safe analytics API in TypeScript
- Analytics API vs direct SQL access: tradeoffs for product teams
- Internal analytics APIs for SaaS products
- How to expose ClickHouse safely to frontend apps

Primary links:

- `/docs/query-definitions`
- `/docs/http-openapi`
- `/docs/react/getting-started`

### 3. Semantic Layer Alternatives

Hub:

- `/blog/topics/semantic-layer`

Next articles:

- Do you need a semantic layer or a typed analytics API?
- Cube alternative for ClickHouse and TypeScript teams
- Semantic layer vs metrics API for AI agents
- Self-service analytics without BI sprawl

Primary links:

- `/docs/why-hypequery`
- `/docs/serve-runtime`
- `/docs/multi-tenancy`

### 4. Schema Management

Hub:

- `/blog/topics/schema-management`

Next articles:

- ClickHouse schema drift: how to stop breaking analytics apps
- Generate TypeScript types from ClickHouse schema
- Safe schema evolution for multi-team analytics stacks
- How to version analytics contracts across services

Primary links:

- `/docs/schemas`
- `/docs/manual-installation`
- `/docs/reference/cli`

### 5. Analytics Architecture

Hub:

- `/blog/topics/analytics-architecture`

Next articles:

- Multi-tenant analytics architecture for SaaS products
- Product analytics backend architecture with ClickHouse
- Governance patterns for internal analytics platforms
- How teams move from dashboards to programmable analytics

Primary links:

- `/use-cases`
- `/use-cases/internal-product-apis`
- `/use-cases/multi-tenant-saas`

## Publishing rules

- Every new article should target one primary hub and at most one secondary hub.
- Every new article should link to its hub page in the intro or conclusion.
- Every new article should link to at least two sibling articles in the same cluster.
- Every new article should link to one product or docs page with matching intent.
- Prefer problem-first titles over product-first titles.

## Priority order

1. Analytics APIs
2. Semantic Layer Alternatives
3. ClickHouse Engineering
4. Analytics Architecture
5. Schema Management
