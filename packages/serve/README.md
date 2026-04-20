# @hypequery/serve

Code-first runtime for exposing hypequery analytics endpoints. Build typed query definitions, run them in-process, and add HTTP routes, docs, and adapters when needed.

## Installation

```bash
npm install @hypequery/serve zod
```

Peer dependency: `tsx@^4` (optional, for dev server)

## Quick Start

Recommended path:

1. Build a typed ClickHouse query
2. Wrap it with `query({ ... })` when it becomes a reusable contract
3. Add `serve({ queries })` when you need HTTP routes, docs, or adapters

```ts
// analytics/queries.ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client';

const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});

const weeklyRevenue = query({
  description: 'Calculate weekly revenue',
  input: z.object({ startDate: z.string() }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('sales')
      .select(['total_amount'])
      .where('date', 'gte', input.startDate)
      .sum('total_amount', 'total')
      .execute(),
});

export const api = serve({
  queries: { weeklyRevenue },
});

// Register an HTTP route
api.route('/weeklyRevenue', api.queries.weeklyRevenue);
```

```ts
// analytics/server.ts
import { api } from './queries';

const server = await api.start({ port: 4000 });

process.on('SIGTERM', async () => {
  await server.stop();
});
```

With the server running:
- **Endpoint**: `POST http://localhost:4000/api/analytics/weeklyRevenue`
- **Docs**: `http://localhost:4000/api/analytics/docs`
- **OpenAPI**: `http://localhost:4000/api/analytics/openapi.json`

---

## Core Concepts

### 1. Create Queries And A Runtime

#### `initServe<TContext, TAuth>(options)`

Main entry point for creating typed query definitions and a serve runtime.

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
  query: QueryFactory<TContext, TAuth>;
  serve<TQueries>(config: ServeConfig<TQueries, TContext, TAuth>): ServeBuilder<TQueries, TContext, TAuth>;
}
```

Use `query({ ... })` to define a typed contract:

```ts
const weeklyRevenue = query({
  description: 'Calculate weekly revenue totals',
  input: z.object({ startDate: z.string() }),
  query: async ({ ctx, input }) => {
    return ctx.db
      .table('sales')
      .where('date', 'gte', input.startDate)
      .sum('amount', 'total')
      .execute();
  },
});
```

Use `serve({ queries })` to expose a typed runtime and optional HTTP surface:

```ts
interface ServeConfig<TQueries, TContext, TAuth> {
  queries: TQueries;
  basePath?: string;
  auth?: AuthStrategy<TAuth> | AuthStrategy<TAuth>[];
  middlewares?: ServeMiddleware<any, any, TContext, TAuth>[];
  tenant?: TenantConfig<TAuth>;
  hooks?: ServeLifecycleHooks<TAuth>;
  openapi?: OpenApiOptions;
  docs?: DocsOptions;
}
```

**Example:**

```ts
const { query, serve } = initServe({
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

const getUser = query({
  input: z.object({ id: z.string() }),
  query: async ({ ctx, input }) => {
    return ctx.db.query.users.findFirst({
      where: eq(users.id, input.id),
    });
  },
});

const weeklyRevenue = query({
  description: 'Calculate weekly revenue totals',
  input: z.object({ startDate: z.string() }),
  query: async ({ ctx, input }) => {
    return ctx.db
      .table('sales')
      .where('date', 'gte', input.startDate)
      .sum('amount', 'total')
      .execute();
  },
});

export const api = serve({
  queries: { getUser, weeklyRevenue },
});

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
import { createApiKeyStrategy, initServe } from '@hypequery/serve';

const apiKeyAuth = createApiKeyStrategy({
  header: 'x-api-key',
  queryParam: 'apiKey',
  validate: async (key) => {
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

const { query, serve } = initServe({
  auth: apiKeyAuth,
  context: () => ({ db }),
});

const revenue = query({
  query: ({ ctx }) => ctx.db.table('sales').sum('amount', 'total').execute(),
});

const api = serve({
  queries: { revenue },
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
import { createBearerTokenStrategy, initServe } from '@hypequery/serve';
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
      return null;
    }
  },
});

const { query, serve } = initServe({
  auth: jwtAuth,
  context: () => ({ db: createDatabase() }),
});

const revenue = query({
  query: ({ ctx }) => ctx.db.table('sales').sum('amount', 'total').execute(),
});

const api = serve({
  queries: { revenue },
});
```

**Usage:**

```bash
curl -H "Authorization: Bearer eyJhbGc..." http://localhost:3000/revenue
```

---

### 4. Query Definition Options

`query({ ... })` accepts query logic plus optional metadata used for validation, docs, caching, and routing.

```ts
interface QueryConfig<TInput, TOutput, TContext, TAuth> {
  query: (args: QueryResolverArgs<TInput, TContext, TAuth>) => Promise<TOutput> | TOutput;
  input?: ZodTypeAny;
  output?: ZodTypeAny;
  description?: string;
  summary?: string;
  tags?: string[];
  method?: HttpMethod;
  cache?: number | null;
  auth?: AuthStrategy<TAuth>;
  tenant?: Partial<TenantConfig<TAuth>>;
  middlewares?: ServeMiddleware<any, any, TContext, TAuth>[];
  metadata?: Record<string, unknown>;
}
```

**Example:**

```ts
const getAnalytics = query({
  description: 'Returns aggregated analytics for the selected metric and date range.',
  summary: 'Analytics totals by date range',
  input: z.object({
    startDate: z.string(),
    endDate: z.string(),
    metric: z.enum(['revenue', 'users', 'sessions']),
  }),
  tags: ['Analytics'],
  cache: 300000,
  query: async ({ ctx, input }) => {
    const result = await ctx.db
      .table('analytics')
      .where('date', 'gte', input.startDate)
      .where('date', 'lte', input.endDate)
      .sum(input.metric, 'total')
      .execute();

    return result[0];
  },
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
const { query, serve } = initServe({
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

const getUsers = query({
  query: async ({ ctx }) => {
    // Manually filter by tenant
    return ctx.db
      .table('users')
      .where('tenant_id', 'eq', ctx.tenantId)
      .execute();
  },
});

export const api = serve({
  queries: { getUsers },
});
```

**Example (Auto-Inject Mode):**

```ts
const { query, serve } = initServe({
  tenant: {
    extract: (auth) => auth?.organizationId ?? null,
    mode: 'auto-inject',
    column: 'organization_id',  // Column to filter on
  },
  context: async () => ({
    db: createDatabase(),
  }),
});

const getUsers = query({
  query: async ({ ctx }) => {
    // Tenant filter is automatically injected
    return ctx.db
      .table('users')
      .select(['id', 'name'])
      .execute();
    // Equivalent to: SELECT id, name FROM users WHERE organization_id = <tenant_id>
  },
});

export const api = serve({
  queries: { getUsers },
});
```

**Per-query override (optional tenant, no auto-inject):**

```ts
const adminStats = query
  .tenantOptional({ mode: 'manual' })
  .query(async ({ ctx }) => {
    if (ctx.tenantId) {
      return ctx.db.table('stats').where('tenant_id', 'eq', ctx.tenantId).execute();
    }
    return ctx.db.table('stats').execute();
  });

export const api = serve({
  queries: { adminStats },
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

const { query, serve } = initServe({
  context: () => ({ db: createDatabase() }),
  middlewares: [logMiddleware],
});

const deleteUser = query({
  input: z.object({ id: z.string() }),
  middlewares: [requireAdmin],
  query: async ({ input, ctx }) => {
    // Only admins can reach here
    return ctx.db.table('users').where('id', 'eq', input.id).execute();
  },
});

const api = serve({
  queries: { deleteUser },
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
const api = serve({
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
const api = serve({
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
const api = serve({
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

const { query, serve } = initServe({
  context: async ({ auth }) => ({
    db: createDatabase(),
    userId: auth?.userId,
  }),
});

const getUser = query({
  input: z.object({ id: z.string() }),
  query: async ({ ctx, input }) => {
    // input: { id: string }
    // ctx: { db: Database; userId: string | undefined }
    return ctx.db
      .table('users')
      .where('id', 'eq', input.id)
      .select(['name', 'email'])
      .limit(1)
      .execute();
  },
});

export const api = serve({
  queries: { getUser },
});

// Execute with type safety (aliases: api.execute, api.client)
const result = await api.run('getUser', { input: { id: '123' } });
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
