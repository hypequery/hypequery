# hypequery Example Dashboard

This example demonstrates how to use hypequery with different ClickHouse clients in different environments.

## Features

### 1. Browser Dashboard (`/`)
- Uses `@clickhouse/client-web` with manual injection
- Direct browser-to-ClickHouse connection
- Real-time filtering and cross-filtering
- Interactive charts and data tables

### 2. Node.js Example (`/nodejs-example`)
- Uses `@clickhouse/client` with manual injection
- Server-side API route (`/api/nodejs-example`)
- Secure credential handling
- Pagination and aggregated statistics

### 3. Streaming Demo (`/streaming`)
- Demonstrates hypequery's streaming capabilities
- Real-time data processing
- Memory-efficient handling of large datasets

### 4. Server Streaming Demo (`/streaming/server`)
- Streams ClickHouse results entirely on the server
- Aggregates data before sending a compact payload to the browser
- Highlights how to pair hypequery streaming with Next.js server components

### 5. Cached Dashboard Helpers (internal utilities)
- Shows how to enable caching for dashboard queries
- Demonstrates cache warming and tag-based invalidation
- Includes `/api/cache/warm` endpoint to pre-populate frequently accessed metrics
- Exposes `/api/cache/stats` to inspect cache hit/miss totals in the UI or monitoring tools

#### Testing caching locally

```ts
// Warm caches (POST /api/cache/warm)
await fetch('/api/cache/warm', { method: 'POST' });

// Reuse cached queries inside components
import { fetchSummaryWithCache } from '@/lib/queries';
const summary = await fetchSummaryWithCache();

// Observe cache stats (GET /api/cache/stats)
const stats = await fetch('/api/cache/stats').then(r => r.json());
console.log('Cache hit rate', stats.hitRate);
```

## Client Setup Examples

### Browser Environment
```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createClient } from '@clickhouse/client-web';

// Manual injection (required for browsers)
const client = createClient({
  host: 'your-clickhouse-host',
  username: 'default',
  password: 'password'
});

const db = createQueryBuilder<IntrospectedSchema>({
  host: 'your-clickhouse-host',
  client // Explicitly provide client
});
```

### Node.js Environment
```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createClient } from '@clickhouse/client';

// Manual injection (recommended for Node.js)
const client = createClient({
  host: 'your-clickhouse-host',
  username: 'default',
  password: 'password'
});

const db = createQueryBuilder<IntrospectedSchema>({
  host: 'your-clickhouse-host',
  client // Explicitly provide client
});
```

## Environment Variables

Set up your ClickHouse connection in `.env.local`:

```env
NEXT_PUBLIC_CLICKHOUSE_HOST=http://localhost:8123
NEXT_PUBLIC_CLICKHOUSE_USER=default
NEXT_PUBLIC_CLICKHOUSE_PASSWORD=password
NEXT_PUBLIC_CLICKHOUSE_DATABASE=default
NEXT_PUBLIC_CACHE_MODE=stale-while-revalidate
NEXT_PUBLIC_CACHE_TTL=5000
NEXT_PUBLIC_CACHE_STALE_TTL=60000
NEXT_PUBLIC_CACHE_MAX_ENTRIES=500
NEXT_PUBLIC_CACHE_MAX_BYTES=52428800
```

## Running the Example

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables in `.env.local`

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Key Differences

| Aspect | Browser | Node.js |
|--------|---------|---------|
| **Client** | `@clickhouse/client-web` | `@clickhouse/client` |
| **Environment** | Client-side | Server-side |
| **Security** | Credentials exposed | Credentials secure |
| **Performance** | Limited by browser | Full Node.js performance |
| **Use Cases** | Real-time dashboards | APIs, data processing |
| **CORS** | Requires configuration | No CORS issues |

## Dependencies

- `@hypequery/clickhouse` - Main query builder
- `@clickhouse/client-web` - Browser client
- `@clickhouse/client` - Node.js client
- `@tanstack/react-query` - Data fetching
- `@tremor/react` - Charts and UI components
- `next` - React framework
- `tailwindcss` - Styling
