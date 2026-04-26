import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse GraphQL — Typed Analytics Resolvers in TypeScript | hypequery',
  description:
    'Use hypequery as the data layer for ClickHouse GraphQL resolvers. Schema-generated types flow from ClickHouse through your resolver to the GraphQL schema — no manual type bridging.',
  robots: {
    index: false,
    follow: true,
  },
  alternates: { canonical: absoluteUrl('/clickhouse-graphql') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-graphql'),
    title: 'ClickHouse GraphQL — Typed Analytics Resolvers in TypeScript | hypequery',
    description:
      'Use hypequery as the data layer for ClickHouse GraphQL resolvers. Schema-generated types flow from ClickHouse through your resolver to the GraphQL schema — no manual type bridging.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse GraphQL — Typed Analytics Resolvers in TypeScript | hypequery',
    description:
      'Use hypequery as the data layer for ClickHouse GraphQL resolvers. Schema-generated types flow from ClickHouse through your resolver to the GraphQL schema — no manual type bridging.',
  },
};

const resolverCode = `import { db } from '@/lib/clickhouse';

// GraphQL schema (SDL)
// type DailyRevenue {
//   orderDate: String!
//   revenue: String!
//   orderCount: String!
// }
// type Query {
//   revenueByDay(startDate: String!, endDate: String!): [DailyRevenue!]!
// }

// Resolver — hypequery return type matches the GraphQL schema shape
export const resolvers = {
  Query: {
    revenueByDay: async (
      _parent: unknown,
      args: { startDate: string; endDate: string },
      ctx: { tenantId: string },
    ) => {
      // Return type: { order_date: string; revenue: string; order_count: string }[]
      // Matches GraphQL schema — no manual bridging or casting needed
      return db
        .table('orders')
        .select([
          'order_date',
          'sum(total) as revenue',
          'count() as order_count',
        ])
        .where('tenant_id', 'eq', ctx.tenantId)
        .where('order_date', 'gte', args.startDate)
        .where('order_date', 'lte', args.endDate)
        .groupBy(['order_date'])
        .orderBy('order_date', 'ASC')
        .execute();
    },
  },
};`;

const apolloServerCode = `import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { db } from '@/lib/clickhouse';
import { verifyJwt } from '@/lib/auth';

const typeDefs = \`#graphql
  type ActiveUser {
    day: String!
    activeUsers: String!
  }

  type TopEvent {
    eventName: String!
    occurrences: String!
  }

  type Query {
    activeUsers(windowDays: Int!): [ActiveUser!]!
    topEvents(limit: Int): [TopEvent!]!
  }
\`;

const resolvers = {
  Query: {
    activeUsers: async (_: unknown, args: { windowDays: number }, ctx: { tenantId: string }) => {
      const start = new Date(Date.now() - args.windowDays * 86_400_000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);

      // hypequery infers column types from schema — no manual interface needed
      return db
        .table('events')
        .select(['toStartOfDay(timestamp) as day', 'uniq(user_id) as active_users'])
        .where('tenant_id', 'eq', ctx.tenantId)
        .where('timestamp', 'gte', start)
        .groupBy(['day'])
        .orderBy('day', 'ASC')
        .execute();
    },

    topEvents: async (_: unknown, args: { limit?: number }, ctx: { tenantId: string }) => {
      return db
        .table('events')
        .select(['event_name', 'count() as occurrences'])
        .where('tenant_id', 'eq', ctx.tenantId)
        .groupBy(['event_name'])
        .orderBy('occurrences', 'DESC')
        .limit(args.limit ?? 10)
        .execute();
    },
  },
};

const server = new ApolloServer({ typeDefs, resolvers });

const { url } = await startStandaloneServer(server, {
  context: async ({ req }) => {
    // Extract tenant from JWT — injected into every resolver via ctx
    const token = req.headers.authorization?.replace('Bearer ', '');
    const payload = token ? verifyJwt(token) : null;
    return { tenantId: payload?.tenantId ?? '' };
  },
});

console.log(\`GraphQL server ready at \${url}\`);`;

export default function ClickHouseGraphQLPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse GraphQL"
      title="Use hypequery as the ClickHouse data layer for GraphQL resolvers"
      description="GraphQL resolvers need a data layer. When that data is in ClickHouse, the naive approach is to call @clickhouse/client directly and return untyped rows. hypequery gives resolvers a typed ClickHouse query builder — column types are inferred from the schema, so the resolver return type matches the GraphQL schema without manual bridging."
      primaryCta={{ href: '/docs/quick-start', label: 'Get started' }}
      secondaryCta={{ href: '/clickhouse-typescript', label: 'See the TypeScript guide' }}
      stats={[
        { label: 'Integration layer', value: 'GraphQL resolver' },
        { label: 'Compatible with', value: 'Apollo Server, GraphQL Yoga' },
        { label: 'Best for', value: 'Analytics in GraphQL APIs' },
      ]}
      problems={[
        {
          title: 'GraphQL resolvers querying ClickHouse return any — schema and ClickHouse types are disconnected',
          copy:
            'GraphQL code-first frameworks infer the schema from resolver return types. When the resolver calls @clickhouse/client and gets back any, the connection between the GraphQL schema and the ClickHouse column definitions is severed. Schema changes in ClickHouse do not surface as TypeScript errors in the resolver — they surface at runtime.',
        },
        {
          title: 'N+1 query problems are worse with ClickHouse because each query carries real cost',
          copy:
            'In a relational database, N+1 queries are inefficient. In ClickHouse, they are often prohibitively expensive. Each ClickHouse query has startup overhead, and analytical queries scan large amounts of data. GraphQL resolver patterns that work fine with Postgres require explicit batching and caching strategies when the data source is ClickHouse.',
        },
        {
          title: 'Auth and tenancy need to flow from GraphQL context to ClickHouse queries without manual wiring',
          copy:
            'GraphQL context carries auth information — user identity, tenant ID, permissions. Every ClickHouse resolver needs to read that context and inject a WHERE tenant_id = clause. Without a shared pattern, each resolver implements its own extraction logic independently.',
        },
      ]}
      solutionSection={{
        eyebrow: 'How it fits together',
        title: 'hypequery resolvers: column types inferred, tenant context injected once',
        description:
          'hypequery infers TypeScript types from your ClickHouse schema via npx @hypequery/cli generate. When you call the query builder inside a GraphQL resolver, the return type is inferred from the column definitions. If the GraphQL schema expects { day: string; activeUsers: string } and the ClickHouse query returns the same shape, TypeScript confirms the match — no casting, no manual interface.',
        bullets: [
          'Run npx @hypequery/cli generate to produce schema.ts — DateTime→string, UInt64→string, Nullable→T|null',
          'Call the hypequery query builder inside GraphQL resolvers and return the result directly',
          'Define tenant context injection once in the GraphQL context factory — every resolver receives ctx.tenantId',
          'Use DataLoader for batching when resolvers are called in parallel (avoids N+1 on ClickHouse)',
          'Type errors surface at compile time if the ClickHouse query shape diverges from the GraphQL schema',
        ],
        codePanel: {
          eyebrow: 'GraphQL resolver',
          title: 'Typed ClickHouse query inside a GraphQL resolver',
          description:
            'ctx.tenantId comes from the GraphQL context factory — defined once, available in every resolver. The return type matches the GraphQL schema shape without any manual bridging.',
          code: resolverCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Apollo Server setup',
        title: 'Apollo Server with hypequery as the ClickHouse resolver layer',
        description:
          'The GraphQL context factory verifies the JWT and extracts tenantId once. Every resolver receives ctx.tenantId and passes it to the hypequery WHERE clause. The ClickHouse query return types align with the GraphQL SDL types — TypeScript catches any mismatch before deployment.',
        paragraphs: [
          'This pattern works identically with GraphQL Yoga, Pothos, or any GraphQL server that supports a context factory. The resolver code is the same regardless of which server library you use — the ClickHouse data layer is decoupled from the HTTP layer.',
          'For analytics queries that are computationally expensive, consider wrapping the hypequery call in a DataLoader to deduplicate identical queries within a single GraphQL request. ClickHouse handles large single queries better than many small ones — batching at the resolver level aligns with that characteristic.',
        ],
        codePanel: {
          eyebrow: 'Full server example',
          title: 'Apollo Server with hypequery analytics resolvers',
          description:
            'Context factory extracts tenant from JWT. Resolvers read ctx.tenantId and pass it to hypequery. The return types align with the SDL type definitions — no separate TypeScript interfaces required.',
          code: apolloServerCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse GraphQL TypeScript',
          copy:
            'Connecting ClickHouse to a GraphQL API in TypeScript requires a data layer that infers column types. Without that, resolvers return any and the type safety that makes GraphQL valuable in TypeScript codebases disappears.',
        },
        {
          title: 'GraphQL analytics ClickHouse resolver',
          copy:
            'Analytics resolvers on ClickHouse need tenant isolation, validated inputs, and typed responses. hypequery handles the ClickHouse side — you define tenant injection in the context factory and the query builder carries it through.',
        },
        {
          title: 'ClickHouse GraphQL schema',
          copy:
            "The GraphQL schema and the ClickHouse schema need to stay in sync. hypequery's CLI generates TypeScript types from the live ClickHouse schema — those types can drive both the resolver implementation and the GraphQL SDL type definitions.",
        },
        {
          title: 'ClickHouse Apollo Server',
          copy:
            'Apollo Server and ClickHouse integrate cleanly with hypequery as the data layer. Define your ClickHouse queries in resolvers, extract tenant context in the Apollo context factory, and let TypeScript verify that the resolver return types match the SDL.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-rest-api',
          title: 'ClickHouse REST API',
          description: 'Expose the same ClickHouse queries as typed REST endpoints alongside your GraphQL API.',
        },
        {
          href: '/clickhouse-typescript',
          title: 'ClickHouse TypeScript',
          description: 'Schema generation and the typed query builder — the foundation for GraphQL resolver integration.',
        },
        {
          href: '/clickhouse-query-builder',
          title: 'ClickHouse Query Builder',
          description: 'The full query builder API — composable queries, typed filters, joins, and CTE helpers.',
        },
        {
          href: '/clickhouse-nodejs',
          title: 'ClickHouse Node.js',
          description: 'Node.js-specific setup and connection configuration for ClickHouse.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-nodejs', label: 'ClickHouse Node.js' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Generate your ClickHouse schema types, then wire them into GraphQL resolvers',
        description:
          'Run npx @hypequery/cli generate to produce typed schema bindings. Call the hypequery query builder inside your resolvers and return the result — column types align with the GraphQL SDL automatically.',
        primaryCta: { href: '/docs/quick-start', label: 'Open the quick start' },
        secondaryCta: { href: '/clickhouse-typescript', label: 'See the TypeScript guide' },
      }}
    />
  );
}
