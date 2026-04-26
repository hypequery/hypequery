import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse OpenAPI — Auto-Generated Docs from Query Definitions | hypequery',
  description:
    'hypequery automatically generates an OpenAPI spec from your ClickHouse query definitions. Ship typed REST APIs with request validation, response schemas, and Swagger UI — no manual documentation.',
  alternates: { canonical: absoluteUrl('/clickhouse-openapi') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-openapi'),
    title: 'ClickHouse OpenAPI — Auto-Generated from Query Definitions | hypequery',
    description:
      'Define ClickHouse queries. Get OpenAPI docs automatically. hypequery generates the full spec from your input and output types.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse OpenAPI — Auto-Generated Docs | hypequery',
    description:
      'hypequery automatically generates an OpenAPI spec from your ClickHouse query definitions — typed endpoints, validation, and Swagger UI included.',
  },
};

const queryCode = `import { initServe } from '@hypequery/serve';
import { z } from 'zod';

const { query, serve } = initServe({ context: () => ({ db }) });

const activeUsers = query({
  input: z.object({
    period: z.enum(['7d', '30d', '90d']),
    region: z.string().optional(),
  }),
  query: async ({ ctx, input }) =>
    ctx.db
      .table('sessions')
      .where('period', 'eq', input.period)
      .groupBy(['user_id'])
      .count('id', 'sessions')
      .execute(),
});

// the input Zod schema becomes the OpenAPI requestBody
// the ClickHouse return type becomes the OpenAPI response schema`;

const openApiOutput = `// GET /openapi.json — generated automatically
{
  "openapi": "3.0.0",
  "paths": {
    "/activeUsers": {
      "post": {
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "period": { "type": "string", "enum": ["7d", "30d", "90d"] },
                  "region": { "type": "string" }
                },
                "required": ["period"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "user_id": { "type": "string" },
                      "sessions": { "type": "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

export default function ClickHouseOpenApiPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse OpenAPI"
      title="Auto-generated OpenAPI docs from ClickHouse query definitions"
      description="When you define ClickHouse queries with hypequery, the OpenAPI specification is generated automatically. Request validation, response schemas, and Swagger UI — all derived from your Zod input schemas and ClickHouse-generated output types. No manual documentation step."
      primaryCta={{ href: '/docs/quick-start', label: 'Get started' }}
      secondaryCta={{ href: '/clickhouse-rest-api', label: 'See the REST API' }}
      stats={[
        { label: 'Spec format', value: 'OpenAPI 3.0' },
        { label: 'Source', value: 'Derived from query types' },
        { label: 'UI', value: 'Swagger included' },
      ]}
      problems={[
        {
          title: 'Analytics APIs are rarely documented',
          copy:
            'Internal ClickHouse analytics APIs almost never have OpenAPI docs — the team writes the endpoints, frontend developers guess the shape from network logs, and breaking changes get discovered at runtime rather than compile time.',
        },
        {
          title: 'Writing OpenAPI specs by hand drifts from the implementation',
          copy:
            'When you hand-write OpenAPI YAML alongside your ClickHouse query code, the two drift immediately. The spec says one shape, the query returns another — and the gap grows with every schema change.',
        },
        {
          title: 'Client generation requires accurate specs',
          copy:
            'Tools like openapi-typescript and openapi-generator can generate fully typed frontend clients from your API spec — but only if the spec is accurate and up to date. A hand-maintained spec is never fully trustworthy.',
        },
      ]}
      solutionSection={{
        eyebrow: 'How it works',
        title: 'The spec is derived from types, not written by hand',
        description:
          'When you define a query with hypequery, the input schema comes from Zod and the output schema comes from the ClickHouse-generated types. @hypequery/serve reads both and generates the OpenAPI spec automatically — it is always in sync with the actual implementation.',
        bullets: [
          'Request body schema derived from your Zod input definition',
          'Response schema derived from ClickHouse-generated TypeScript types',
          'Full OpenAPI 3.0 spec available at /openapi.json',
          'Interactive Swagger UI available at /docs',
          'Spec updates automatically when query definitions change',
        ],
        codePanel: {
          eyebrow: 'Query definition',
          title: 'Input and output types become the OpenAPI spec',
          description:
            'The Zod schema defines the request body. The ClickHouse return type defines the response. hypequery generates the OpenAPI spec from both — no manual step.',
          code: queryCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Generated output',
        title: 'The OpenAPI spec reflects your real types, always',
        description:
          'The generated spec is derived directly from the types in your codebase — not from a separate documentation layer. When you change a query input or the ClickHouse schema changes, the spec updates automatically on the next generate run.',
        paragraphs: [
          'This makes client generation reliable. Use openapi-typescript to generate a fully typed frontend client from the spec — knowing it reflects the actual query shapes.',
          'See the REST API guide for the full serve() setup, and the React hooks guide for consuming the typed endpoints in dashboard components.',
        ],
        codePanel: {
          eyebrow: 'Generated spec',
          title: 'OpenAPI output for the activeUsers query',
          description:
            'The spec reflects the Zod input schema and the ClickHouse output types exactly. Use it to generate typed clients, share with third-party consumers, or power Swagger UI.',
          code: openApiOutput,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse API documentation',
          copy:
            'Most ClickHouse analytics APIs have no documentation because hand-writing OpenAPI specs is too slow. hypequery generates the spec automatically from your query type definitions — no manual documentation step.',
        },
        {
          title: 'Generate OpenAPI from ClickHouse TypeScript',
          copy:
            'If your ClickHouse analytics are served as HTTP endpoints, hypequery can generate the OpenAPI spec from your TypeScript query definitions. Input validation, response types, and Swagger UI all included.',
        },
        {
          title: 'ClickHouse API client generation',
          copy:
            'With an accurate OpenAPI spec from hypequery, you can generate fully typed frontend clients using openapi-typescript or similar tools. The spec is always in sync with the implementation.',
        },
        {
          title: 'ClickHouse Swagger UI',
          copy:
            'hypequery serves an interactive Swagger UI at /docs automatically. Your analytics endpoints are explorable and testable from the browser without any additional tooling setup.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-rest-api',
          title: 'ClickHouse REST API',
          description: 'The full guide to serving ClickHouse queries as typed HTTP endpoints with @hypequery/serve.',
        },
        {
          href: '/clickhouse-query-builder',
          title: 'ClickHouse Query Builder',
          description: 'The query definitions that drive the OpenAPI spec and the HTTP endpoints.',
        },
        {
          href: '/clickhouse-react',
          title: 'ClickHouse React hooks',
          description: 'Consume your typed REST endpoints as React hooks for dashboard components.',
        },
        {
          href: '/clickhouse-schema',
          title: 'ClickHouse schema generation',
          description: 'How the TypeScript types are generated from your ClickHouse schema — the source of the response schemas.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Get OpenAPI docs from your first ClickHouse query',
        description:
          'Define a query, serve it with @hypequery/serve, and visit /openapi.json. The spec is generated immediately from your input and output types.',
        primaryCta: { href: '/docs/quick-start', label: 'Open quick start' },
        secondaryCta: { href: '/clickhouse-rest-api', label: 'See the REST API guide' },
      }}
    />
  );
}
