# ClickHouse Client Support

This document explains how `@hypequery/clickhouse` supports both ClickHouse client packages for different environments.

## Overview

The library is designed to work with both ClickHouse client packages:

- **`@clickhouse/client-web`**: Web/browser implementation
- **`@clickhouse/client`**: Node.js implementation

## Current Implementation

### Primary Dependency
The library currently uses `@clickhouse/client-web` as its primary dependency:

```json
{
  "dependencies": {
    "@clickhouse/client-web": "^0.2.0"
  }
}
```

### Optional Peer Dependency
`@clickhouse/client` is available as an optional peer dependency:

```json
{
  "peerDependencies": {
    "@clickhouse/client": "^0.2.0 || ^1.0.0"
  },
  "peerDependenciesMeta": {
    "@clickhouse/client": {
      "optional": true
    }
  }
}
```

## Client Selection

### Automatic Selection (Default)
The library automatically selects the best client for your environment:

```typescript
const db = createQueryBuilder<YourSchema>({
  host: 'http://localhost:8123',
  username: 'default',
  password: 'your-password',
  database: 'your-database',
  clientType: 'auto' // Default behavior
});
```

**Selection Logic:**
- **Node.js environment**: Tries `@clickhouse/client` first, falls back to `@clickhouse/client-web`
- **Browser environment**: Uses `@clickhouse/client-web`

### Manual Selection
You can explicitly specify which client to use:

```typescript
// Force Node.js client (requires @clickhouse/client)
const db = createQueryBuilder<YourSchema>({
  host: 'http://localhost:8123',
  clientType: 'node' // Uses @clickhouse/client
});

// Force web client (requires @clickhouse/client-web)
const db = createQueryBuilder<YourSchema>({
  host: 'http://localhost:8123',
  clientType: 'web' // Uses @clickhouse/client-web
});
```

## Usage Patterns

### Browser/Web Environments
For React, Vue, or other browser-based applications:

```bash
npm install @hypequery/clickhouse @clickhouse/client-web
```

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';

const db = createQueryBuilder<YourSchema>({
  host: '/api/clickhouse', // Proxy through your API route
  username: 'default',
  password: '',
  database: 'default',
  clientType: 'web' // Explicitly use web client
});
```

### Node.js Environments
For Express, Next.js API routes, or other server-side applications:

```bash
npm install @hypequery/clickhouse @clickhouse/client
```

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';

const db = createQueryBuilder<YourSchema>({
  host: 'http://your-clickhouse-server:8123',
  username: 'default',
  password: 'your-password',
  database: 'default',
  clientType: 'node' // Explicitly use Node.js client for better performance
});
```

## Configuration

Both client packages use the same configuration format:

```typescript
const db = createQueryBuilder<YourSchema>({
  host: 'http://localhost:8123', // or https://your-instance.clickhouse.cloud:8443
  username: 'default',
  password: 'your-password',
  database: 'your-database',
  clientType: 'auto' // 'web', 'node', or 'auto'
});
```

## API Compatibility

The API remains the same regardless of which client package you use:

```typescript
// This works the same with both clients
const results = await db
  .table('users')
  .select(['id', 'name', 'email'])
  .where('status', '=', 'active')
  .execute();
```

## Environment-Specific Considerations

### Browser Environment
- Requires `@clickhouse/client-web`
- May need CORS proxy setup
- Limited by browser security policies
- Use `clientType: 'web'` for explicit control

### Node.js Environment
- Can use either client package
- Direct connection to ClickHouse server
- Full access to Node.js APIs
- Use `clientType: 'node'` for better performance

## Troubleshooting

### Common Issues

1. **Missing Client Package**: Install the appropriate client for your environment
2. **CORS Issues**: Use a proxy server for browser environments
3. **Type Errors**: Ensure you're using the correct client for your environment

### Error Messages

- "@clickhouse/client not found": Install `@clickhouse/client` for Node.js environments
- "@clickhouse/client-web could not be imported": Install `@clickhouse/client-web`
- "Connection refused": Check your ClickHouse server configuration
- "Authentication failed": Verify your credentials

## Examples

### Browser Example (React)
```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated-schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: '/api/clickhouse', // Proxy through your API route
  username: 'default',
  password: '',
  database: 'default',
  clientType: 'web' // Explicitly use web client
});
```

### Node.js Example (Express)
```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated-schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: 'http://your-clickhouse-server:8123',
  username: 'default',
  password: 'your-password',
  database: 'default',
  clientType: 'node' // Explicitly use Node.js client for better performance
});
```

### Universal Example (Works in both environments)
```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated-schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST || '/api/clickhouse',
  username: 'default',
  password: '',
  database: 'default',
  clientType: 'auto' // Automatically chooses the best client
});
```

## Conclusion

The current implementation provides a good balance between simplicity and flexibility. Users can choose the appropriate client for their environment while maintaining a consistent API. The synchronous initialization approach makes the library easier to use, while the `clientType` option provides explicit control when needed. 