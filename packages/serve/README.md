# @hypequery/serve

Declarative HTTP server for exposing hypequery analytics endpoints. Build type-safe REST APIs with automatic OpenAPI documentation, authentication, middleware, and multi-platform deployment support.

## Installation

```bash
npm install @hypequery/serve zod
```

Peer dependencies: `zod@^3`, `tsx@^4` (optional, for dev server)

## Quick Start

```ts
// analytics/server.ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client';

const { define, queries, query } = initServe({
  context: () => ({ db }),
});

export const api = define({
  queries: queries({
    weeklyRevenue: query
      .describe('Calculate weekly revenue')
      .input(z.object({ startDate: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db
          .table('sales')
          .select(['total_amount'])
          .where('date', 'gte', input.startDate)
          .sum('total_amount', 'total')
          .execute()
      ),
  }),
});

// Expose as HTTP endpoint
api.route('/weeklyRevenue', api.queries.weeklyRevenue);
```

Your API is now running with:
- **Endpoint**: `POST http://localhost:4000/weeklyRevenue`
- **Docs**: `http://localhost:4000/docs` (interactive Swagger UI)
- **OpenAPI**: `http://localhost:4000/openapi.json` (machine-readable schema)

---

## Core Concepts

### 1. Server Builders

#### `initServe<TContext, TAuth>(options)`

Main entry point for creating a hypequery server. Returns an initializer with type-safe query builders and context inference.

**Parameters:**

```ts
interface ServeInitializerOptions<TContext, TAuth> {
  // Context factory (runs per-request to inject dependencies)
  context: TContext | ((opts: { request: ServeRequest; auth: TAuth | null }) => TContext | Promise<TContext>);

  // Base path for all routes
  basePath?: string;

  // Authentication strategy
  auth?: AuthStrategy<TAuth> | AuthStrategy<TAuth>[];

  // Global middlewares (run before every endpoint)
  middlewares?: ServeMiddleware<any, any, TContext, TAuth>[];

  // Multi-tenancy configuration
  tenant?: TenantConfig<TAuth>;

  // Lifecycle hooks
  hooks?: ServeLifecycleHooks<TAuth>;

  // OpenAPI configuration
  openapi?: OpenApiOptions;

  // Docs UI configuration
  docs?: DocsOptions;
}
```

**Returns:**

```ts
interface ServeInitializer<TContext, TAuth> {
  // Query builder (chainable query configuration)
  query: QueryProcedureBuilder<TContext, TAuth>;

  // Helper to group multiple queries
  queries<TQueries>(definitions: TQueries): TQueries;

  // Define server with queries
  define<TQueries>(config: { queries: TQueries }): ServeBuilder<TQueries, TContext, TAuth>;
}
```

**Example:**

```ts
// Define context once
const { define, queries, query } = initServe({
  basePath: '/api',
  context: async ({ auth }) => ({
    db: createDatabase(),
    userId: auth?.userId,
  }),
  auth: createBearerTokenStrategy({
    validate: async (token) => {
      const user = await verifyJWT(token);
      return user ? { userId: user.id, role: user.role } : null;
    },
  }),
});

// Create queries with inferred types
export const api = define({
  queries: queries({
    getUser: query
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        return ctx.db.query.users.findFirst({
          where: eq(users.id, input.id),
        });
      }),

    weeklyRevenue: query
      .describe('Calculate weekly revenue totals')
      .input(z.object({ startDate: z.string() }))
      .query(async ({ ctx, input }) => {
        return ctx.db
          .table('sales')
          .where('date', 'gte', input.startDate)
          .sum('amount', 'total')
          .execute();
      }),
  }),
});

// Expose as HTTP endpoints
api.route('/users/:id', api.queries.getUser, { method: 'GET' });
api.route('/weeklyRevenue', api.queries.weeklyRevenue);
```

---

### 2. HTTP Adapters

Adapters convert the framework-agnostic `ServeHandler` into platform-specific handlers.

#### `createNodeHandler(handler)`

Creates a Node.js HTTP handler for use with `http.createServer()` or Express.

```ts
import { createNodeHandler } from '@hypequery/serve';
import { createServer } from 'http';

const nodeHandler = createNodeHandler(api.handler);
const server = createServer(nodeHandler);
server.listen(3000);
```

---

#### `createFetchHandler(handler)`

Creates a Web Fetch API handler for modern runtimes (Cloudflare Workers, Deno, Bun).

```ts
import { createFetchHandler } from '@hypequery/serve';

const fetchHandler = createFetchHandler(api.handler);

// Cloudflare Workers
export default {
  fetch: fetchHandler,
};

// Deno
Deno.serve(fetchHandler);

// Bun
Bun.serve({
  fetch: fetchHandler,
  port: 3000,
});
```

---

#### `createVercelEdgeHandler(handler)`

Creates a Vercel Edge Runtime handler (uses Fetch API).

```ts
// pages/api/analytics.ts
import { createVercelEdgeHandler } from '@hypequery/serve';
import { api } from '@/analytics/server';

export const config = { runtime: 'edge' };
export default createVercelEdgeHandler(api.handler);
```

---

#### `createVercelNodeHandler(handler)`

Creates a Vercel Node.js handler (uses Node HTTP).

```ts
// pages/api/analytics.ts
import { createVercelNodeHandler } from '@hypequery/serve';
import { api } from '@/analytics/server';

export default createVercelNodeHandler(api.handler);
```

---

### 3. Authentication

#### `createApiKeyStrategy<TAuth>(options)`

Creates an authentication strategy that validates API keys from headers or query parameters.

**Parameters:**

```ts
interface ApiKeyStrategyOptions<TAuth> {
  header?: string;        // Header name (default: "authorization")
  queryParam?: string;    // Query param name (optional)
  validate: (key: string, request: ServeRequest) => Promise<TAuth | null> | TAuth | null;
}
```

**Example:**

```ts
import { createApiKeyStrategy } from '@hypequery/serve';

const apiKeyAuth = createApiKeyStrategy({
  header: 'x-api-key',
  queryParam: 'apiKey',  // Allow ?apiKey=xxx for development
  validate: async (key, request) => {
    const user = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.key, key),
    });

    if (!user || user.revoked) return null;

    return {
      userId: user.userId,
      scopes: user.scopes,
    };
  },
});

const api = defineServe({
  auth: apiKeyAuth,
  queries: { /* ... */ },
});
```

**Usage:**

```bash
# Header (preferred)
curl -H "x-api-key: sk_live_abc123" http://localhost:3000/revenue

# Query param (development only)
curl http://localhost:3000/revenue?apiKey=sk_live_abc123
```

---

#### `createBearerTokenStrategy<TAuth>(options)`

Creates an authentication strategy that validates Bearer tokens (JWT, OAuth).

**Parameters:**

```ts
interface BearerTokenStrategyOptions<TAuth> {
  header?: string;   // Header name (default: "authorization")
  prefix?: string;   // Token prefix (default: "Bearer ")
  validate: (token: string, request: ServeRequest) => Promise<TAuth | null> | TAuth | null;
}
```

**Example:**

```ts
import { createBearerTokenStrategy } from '@hypequery/serve';
import jwt from 'jsonwebtoken';

const jwtAuth = createBearerTokenStrategy({
  validate: async (token) => {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET) as {
        sub: string;
        role: string;
      };

      return {
        userId: payload.sub,
        role: payload.role,
      };
    } catch {
      return null;  // Invalid token
    }
  },
});

const api = defineServe({
  auth: jwtAuth,
  queries: { /* ... */ },
});
```

**Usage:**

```bash
curl -H "Authorization: Bearer eyJhbGc..." http://localhost:3000/revenue
```

---

### 4. Query Builder (Advanced Query Configuration)

The query builder provides a chainable API for configuring queries with full type inference.

**Available Methods:**

```ts
interface QueryProcedureBuilder<TContext, TAuth> {
  // Description (OpenAPI documentation, supports Markdown)
  describe(description: string): QueryProcedureBuilder;

  // Input schema (Zod)
  input<TSchema extends ZodTypeAny>(schema: TSchema): QueryProcedureBuilder;

  // HTTP method (GET, POST, PUT, DELETE, etc.)
  method(method: HttpMethod): QueryProcedureBuilder;

  // Add single tag (for OpenAPI grouping)
  tag(tag: string): QueryProcedureBuilder;

  // Add multiple tags
  tags(tags: string[]): QueryProcedureBuilder;

  // Cache TTL in milliseconds (sets Cache-Control header)
  cache(ttlMs: number | null): QueryProcedureBuilder;

  // Authentication strategy (overrides global auth)
  auth(strategy: AuthStrategy<TAuth>): QueryProcedureBuilder;

  // Multi-tenancy configuration
  tenant(config: TenantConfig<TAuth>): QueryProcedureBuilder;

  // Custom metadata (for extensions)
  custom(metadata: Record<string, unknown>): QueryProcedureBuilder;

  // Add middleware (runs before query handler)
  use(...middlewares: ServeMiddleware[]): QueryProcedureBuilder;

  // Define query handler (terminal operation)
  query<TExecutable extends ExecutableQuery>(
    executable: TExecutable
  ): ServeQueryConfig;
}
```

**Example:**

```ts
const { query } = initServe({
  context: async () => ({ db: createDatabase() }),
});

const getAnalytics = query
  .describe(`
    Returns aggregated analytics for the specified metric and date range.
    Supports revenue, user count, and session metrics.
  `)
  .input(z.object({
    startDate: z.string(),
    endDate: z.string(),
    metric: z.enum(['revenue', 'users', 'sessions']),
  }))
  .tag('Analytics')
  .cache(300000)  // Cache for 5 minutes
  .query(async ({ ctx, input }) => {
    const result = await ctx.db
      .table('analytics')
      .where('date', 'gte', input.startDate)
      .where('date', 'lte', input.endDate)
      .sum(input.metric, 'total')
      .execute();

    return result[0];
  });
```

---

### 5. Multi-Tenancy

Hypequery supports multi-tenant applications with automatic tenant isolation.

**Configuration:**

```ts
interface TenantConfig<TAuth> {
  // Extract tenant ID from auth context
  extract: (auth: TAuth) => string | null;

  // Tenant isolation mode
  mode?: 'manual' | 'auto-inject';  // Default: 'manual'

  // Column name for tenant filtering (required for auto-inject mode)
  column?: string;

  // Is tenant required? (default: true)
  required?: boolean;

  // Custom error message when tenant is missing
  errorMessage?: string;
}
```

**Example (Manual Mode):**

```ts
const { define, queries, query } = initServe({
  tenant: {
    extract: (auth) => auth?.tenantId ?? null,
    mode: 'manual',  // You manually filter by tenantId
    required: true,
  },
  context: async ({ auth }) => ({
    db: createDatabase(),
    tenantId: auth?.tenantId,
  }),
});

export const api = define({
  queries: queries({
    getUsers: query
      .query(async ({ ctx }) => {
        // Manually filter by tenant
        return ctx.db
          .table('users')
          .where('tenant_id', 'eq', ctx.tenantId)
          .execute();
      }),
  }),
});
```

**Example (Auto-Inject Mode):**

```ts
const { define, queries, query } = initServe({
  tenant: {
    extract: (auth) => auth?.organizationId ?? null,
    mode: 'auto-inject',
    column: 'organization_id',  // Column to filter on
  },
  context: async () => ({
    db: createDatabase(),
  }),
});

export const api = define({
  queries: queries({
    getUsers: query
      .query(async ({ ctx }) => {
        // Tenant filter is automatically injected
        return ctx.db
          .table('users')
          .select(['id', 'name'])
          .execute();
        // Equivalent to: SELECT id, name FROM users WHERE organization_id = <tenant_id>
      }),
  }),
});
```

---

### 6. Client Configuration

#### `extractClientConfig(api)`

Extracts serializable client configuration from a `ServeBuilder`. Returns HTTP method information for each query, used by `@hypequery/react` to configure hooks.

**Example:**

```ts
// Server-side API route
import { api } from '@/analytics/server';
import { extractClientConfig } from '@hypequery/serve';

export async function GET() {
  return Response.json(extractClientConfig(api));
}

// Returns:
// {
//   "weeklyRevenue": { "method": "GET" },
//   "createSale": { "method": "POST" }
// }
```

**Client-side usage:**

```ts
// lib/analytics.ts
import { createHooks } from '@hypequery/react';
import type { Api } from '@/analytics/server';

const config = await fetch('/api/config').then(r => r.json());

export const { useQuery, useMutation } = createHooks<Api>({
  baseUrl: '/api/analytics',
  config,  // Auto-configures HTTP methods
});
```

---

#### `defineClientConfig(config)`

Type-safe helper to manually define client configuration when you can't access the API object.

**Example:**

```ts
import { defineClientConfig } from '@hypequery/serve';

const config = defineClientConfig({
  weeklyRevenue: { method: 'GET' },
  createSale: { method: 'POST' },
  updateProduct: { method: 'PUT' },
  deleteOrder: { method: 'DELETE' },
});

export const { useQuery, useMutation } = createHooks<Api>({
  baseUrl: '/api',
  config,
});
```

---

### 7. Development Server

#### `serveDev(api, options?)`

Starts a development server with enhanced logging and automatic documentation.

**Parameters:**

```ts
interface ServeDevOptions {
  port?: number;          // Default: 4000 or process.env.PORT
  hostname?: string;      // Default: 'localhost'
  quiet?: boolean;        // Suppress logs (default: false)
  signal?: AbortSignal;   // Graceful shutdown signal
  logger?: (message: string) => void;  // Custom logger
}
```

**Example:**

```ts
import { serveDev } from '@hypequery/serve';
import { api } from './analytics/server';

await serveDev(api, {
  port: 4000,
  logger: (msg) => console.log(`[API] ${msg}`),
});

// Output:
// [API] hypequery dev server running at http://localhost:4000
// [API] Docs available at http://localhost:4000/docs
```

---

## Advanced Features

### Middleware

Middlewares run before query handlers and can modify context, validate permissions, or log requests.

**Signature:**

```ts
type ServeMiddleware<TInput, TOutput, TContext, TAuth> = (
  ctx: EndpointContext<TInput, TContext, TAuth>,
  next: () => Promise<TOutput>
) => Promise<TOutput>;
```

**Example:**

```ts
// Logging middleware
const logMiddleware: ServeMiddleware<any, any, any, any> = async (ctx, next) => {
  console.log(`[${ctx.request.method}] ${ctx.request.path}`);
  const start = Date.now();
  const result = await next();
  console.log(`Completed in ${Date.now() - start}ms`);
  return result;
};

// Permission middleware
const requireAdmin: ServeMiddleware<any, any, any, { role: string }> = async (ctx, next) => {
  if (ctx.auth?.role !== 'admin') {
    throw new Error('Admin access required');
  }
  return next();
};

// Apply globally
const api = defineServe({
  middlewares: [logMiddleware],
  queries: { /* ... */ },
});

// Apply per-query
const deleteUser = t.procedure
  .use(requireAdmin)
  .query(async ({ input, ctx }) => {
    // Only admins can reach here
  });
```

---

### Lifecycle Hooks

Hooks provide observability into the request lifecycle.

**Available Hooks:**

```ts
interface ServeLifecycleHooks<TAuth> {
  // Before request processing
  onRequestStart?: (event: {
    requestId: string;
    queryKey: string;
    metadata: EndpointMetadata;
    request: ServeRequest;
    auth: TAuth | null;
  }) => void | Promise<void>;

  // After successful request
  onRequestEnd?: (event: {
    requestId: string;
    queryKey: string;
    metadata: EndpointMetadata;
    request: ServeRequest;
    auth: TAuth | null;
    durationMs: number;
    result: unknown;
  }) => void | Promise<void>;

  // On authentication failure
  onAuthFailure?: (event: {
    requestId: string;
    queryKey: string;
    metadata: EndpointMetadata;
    request: ServeRequest;
    auth: TAuth | null;
    reason: 'MISSING' | 'INVALID';
  }) => void | Promise<void>;

  // On any error
  onError?: (event: {
    requestId: string;
    queryKey: string;
    metadata: EndpointMetadata;
    request: ServeRequest;
    auth: TAuth | null;
    durationMs: number;
    error: unknown;
  }) => void | Promise<void>;
}
```

**Example:**

```ts
const api = defineServe({
  hooks: {
    onRequestStart: async (event) => {
      await analytics.track({
        event: 'api_request_start',
        queryKey: event.queryKey,
        userId: event.auth?.userId,
      });
    },

    onError: async (event) => {
      await errorReporting.captureException(event.error, {
        queryKey: event.queryKey,
        requestId: event.requestId,
      });
    },
  },
  queries: { /* ... */ },
});
```

---

### OpenAPI Configuration

**Options:**

```ts
interface OpenApiOptions {
  enabled?: boolean;       // Enable OpenAPI endpoint (default: true)
  path?: string;           // OpenAPI JSON path (default: '/openapi.json')
  info?: {
    title?: string;        // API title (default: 'Hypequery API')
    version?: string;      // API version (default: '1.0.0')
    description?: string;  // API description
  };
  servers?: Array<{
    url: string;
    description?: string;
  }>;
}
```

**Example:**

```ts
const api = defineServe({
  openapi: {
    path: '/api-schema.json',
    info: {
      title: 'Analytics API',
      version: '2.0.0',
      description: 'Real-time analytics and reporting API',
    },
    servers: [
      { url: 'https://api.example.com', description: 'Production' },
      { url: 'http://localhost:4000', description: 'Development' },
    ],
  },
  queries: { /* ... */ },
});
```

---

### Documentation UI

**Options:**

```ts
interface DocsOptions {
  enabled?: boolean;  // Enable docs UI (default: true)
  path?: string;      // Docs UI path (default: '/docs')
  title?: string;     // Page title (default: 'API Documentation')
}
```

**Example:**

```ts
const api = defineServe({
  docs: {
    path: '/api-docs',
    title: 'Analytics API Reference',
  },
  queries: { /* ... */ },
});
```

---

## Deployment Examples

### Vercel (Edge Runtime)

```ts
// pages/api/analytics/[...path].ts
import { createVercelEdgeHandler } from '@hypequery/serve';
import { api } from '@/analytics/server';

export const config = { runtime: 'edge' };
export default createVercelEdgeHandler(api.handler);
```

---

### Cloudflare Workers

```ts
// src/index.ts
import { createFetchHandler } from '@hypequery/serve';
import { api } from './analytics/server';

const handler = createFetchHandler(api.handler);

export default {
  fetch: handler,
};
```

---

### Express.js

```ts
// server.ts
import express from 'express';
import { createNodeHandler } from '@hypequery/serve';
import { api } from './analytics/server';

const app = express();
const analyticsHandler = createNodeHandler(api.handler);

app.use('/api/analytics', analyticsHandler);
app.listen(3000);
```

---

### Next.js App Router

```ts
// app/api/analytics/[...path]/route.ts
import { createFetchHandler } from '@hypequery/serve';
import { api } from '@/analytics/server';

const handler = createFetchHandler(api.handler);

export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
```

---

## TypeScript

All functions are fully typed with automatic inference:

```ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';

const { define, queries, query } = initServe({
  context: async ({ auth }) => ({
    db: createDatabase(),
    userId: auth?.userId,
  }),
});

export const api = define({
  queries: queries({
    getUser: query
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        // input: { id: string }
        // ctx: { db: Database; userId: string | undefined }
        return ctx.db
          .table('users')
          .where('id', 'eq', input.id)
          .select(['name', 'email'])
          .limit(1)
          .execute();
      }),
  }),
});

// Execute with type safety
const result = await api.run('getUser', { id: '123' });
const user = result[0];
// user: { name: string; email: string }
```

---

## Error Handling

All errors follow a consistent format:

```ts
interface ErrorEnvelope {
  error: {
    type: 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'INTERNAL_SERVER_ERROR';
    message: string;
    details?: Record<string, unknown>;
  };
}
```

**Example Error Response:**

```json
{
  "error": {
    "type": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "issues": [
        {
          "code": "invalid_type",
          "expected": "string",
          "received": "number",
          "path": ["startDate"],
          "message": "Expected string, received number"
        }
      ]
    }
  }
}
```

---

## License

Apache-2.0
