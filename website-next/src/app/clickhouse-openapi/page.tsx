import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse OpenAPI — Auto-Generated Docs from Query Definitions | hypequery',
  description:
    'Generate an OpenAPI spec from real ClickHouse query definitions so your docs, request validation, and response schemas stay aligned with the code you actually ship.',
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
      description="Most internal analytics APIs never get documented properly because the spec is a second thing to maintain. hypequery makes the docs fall out of the query definition, so the request shape, response shape, and served endpoint stay in sync."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/clickhouse-rest-api', label: 'See the REST API' }}
      stats={[
        { label: 'Spec format', value: 'OpenAPI 3.0' },
        { label: 'Source', value: 'Derived from query types' },
        { label: 'UI', value: 'Swagger included' },
      ]}
      problems={[
        {
          title: 'Hand-written specs drift from real endpoints',
          copy:
            'Teams update the route, forget the YAML, and then frontend code is generated from a spec that no longer matches production. That is worse than having no spec at all.',
        },
        {
          title: 'Frontend teams still need a contract they can trust',
          copy:
            'If a dashboard or another service is consuming the API, “ask backend for the shape” does not scale. They need a stable spec that reflects the actual query output.',
        },
        {
          title: 'Documentation is usually treated as a separate project',
          copy:
            'As soon as docs become a parallel workflow, they slip. The only durable version is one derived from the same definitions that serve the endpoint.',
        },
      ]}
      solutionSection={{
        eyebrow: 'What actually happens',
        title: 'Define the query once and let the spec come from it',
        description:
          'The query definition already contains the pieces an API spec needs: validated input, a known endpoint, and a typed response. hypequery uses those pieces directly instead of asking you to mirror them in a second file.',
        bullets: [
          'Request body schema derived from your Zod input definition',
          'Response schema derived from ClickHouse-generated TypeScript types',
          'Full OpenAPI 3.0 spec available at /openapi.json',
          'Interactive Swagger UI available at /docs',
          'Spec changes when the query definition changes, not on a separate docs schedule',
        ],
        codePanel: {
          eyebrow: 'Query definition',
          title: 'The source of truth is the served query',
          description:
            'This is the only code you should need to maintain. The spec is derived from the input schema and the inferred query result instead of being copied into OpenAPI YAML.',
          code: queryCode,
        },
      }}
      implementationSection={{
        eyebrow: 'What the client sees',
        title: 'The generated spec is boring in the right way',
        description:
          'A good generated spec should look ordinary. That is the point. Consumers get a standard OpenAPI document they can inspect, feed into tooling, or use to generate clients without knowing anything about hypequery.',
        paragraphs: [
          'That makes client generation viable again. If you feed this into `openapi-typescript`, the resulting client types are grounded in the same query definitions that serve production traffic.',
          'If your main problem is the endpoint layer itself, go to the REST API page. If the problem is browser consumption, pair this with the React page.',
        ],
        codePanel: {
          eyebrow: 'Generated spec',
          title: 'A normal OpenAPI response, not a custom format',
          description:
            'What matters here is not the JSON itself. It is that the output is plain OpenAPI, which means the rest of your tooling can stay standard.',
          code: openApiOutput,
        },
      }}
      searchIntentCards={[
        {
          title: 'Why this is better than writing YAML',
          copy:
            'You stop maintaining two parallel descriptions of the same endpoint. The served query is the implementation, and the OpenAPI document is a by-product of that implementation.',
        },
        {
          title: 'What frontend teams get out of it',
          copy:
            'A trustworthy spec means frontend codegen becomes practical again. Consumers can generate types or clients without reverse-engineering responses from network tabs.',
        },
        {
          title: 'When this page matters',
          copy:
            'This page matters once a query is no longer private implementation detail and needs external consumers, generated clients, or documentation that survives team growth.',
        },
        {
          title: 'When it does not',
          copy:
            'If you only run queries locally inside one service, OpenAPI is not the point. The value starts when other people or other apps need to call what you built.',
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
        title: 'Serve one query and inspect the generated spec',
        description:
          'Pick a real analytics query, expose it through `serve()`, and look at `/openapi.json`. That gives you a much better signal than polishing a docs layer before the endpoint even exists.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/clickhouse-rest-api', label: 'See the REST API guide' },
      }}
    />
  );
}
