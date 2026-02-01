# Auth Guards Playground

A hands-on example demonstrating all `@hypequery/serve` auth guard features with hard-coded data (no database required).

## Features Demonstrated

- ✅ Public endpoints (`.public()`)
- ✅ Authentication guards (`.requireAuth()`)
- ✅ Role-based authorization (`.requireRole()`) with OR semantics
- ✅ Scope-based authorization (`.requireScope()`) with AND semantics
- ✅ Combined guards (`.requireRole().requireScope()`)
- ✅ Type-safe auth with `createAuthSystem`
- ✅ Per-endpoint auth overrides
- ✅ OpenAPI documentation with auth requirements

## Setup

```bash
# Install dependencies (from repo root)
pnpm install

# Or in this directory
npm install
```

## Usage

### Start the Server

```bash
npm run dev
```

Server runs at `http://localhost:4321`

### Run Tests

In a separate terminal:

```bash
npm test
```

This runs 20 test cases covering all auth scenarios.

### Run Embedded Execution Example

Auth guards work exactly the same for in-process execution:

```bash
npm run embedded
```

This demonstrates calling `api.run()` directly (no HTTP server) with auth guards.

## Test Users

| User | API Key | Role | Scopes |
|------|---------|------|--------|
| Alice | `user-1` | admin | read:metrics, write:metrics, delete:metrics |
| Bob | `user-2` | editor | read:metrics, write:metrics |
| Charlie | `user-3` | viewer | read:metrics |

## Manual Testing with curl

### Public endpoint (no auth required)
```bash
curl http://localhost:4321/healthcheck
```

### Authenticated endpoint
```bash
# Without auth (401)
curl http://localhost:4321/profile

# With auth (200)
curl -H "x-api-key: user-1" http://localhost:4321/profile
```

### Role-based access (admin OR editor)
```bash
# Viewer (403)
curl -H "x-api-key: user-3" http://localhost:4321/metrics

# Editor (200)
curl -H "x-api-key: user-2" http://localhost:4321/metrics

# Admin (200)
curl -H "x-api-key: user-1" http://localhost:4321/metrics
```

### Scope-based access (requires BOTH scopes)
```bash
# Viewer only has read:metrics (403)
curl -X POST \
  -H "x-api-key: user-3" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","value":100}' \
  http://localhost:4321/metrics/create

# Editor has read:metrics AND write:metrics (200)
curl -X POST \
  -H "x-api-key: user-2" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","value":100}' \
  http://localhost:4321/metrics/create
```

### Admin-only endpoint
```bash
# Editor (403)
curl -H "x-api-key: user-2" http://localhost:4321/secrets

# Admin (200)
curl -H "x-api-key: user-1" http://localhost:4321/secrets
```

### Combined guards (role + scope)
```bash
# Editor has delete:metrics scope but not admin role (403)
curl -X POST \
  -H "x-api-key: user-2" \
  -H "Content-Type: application/json" \
  -d '{"id":1}' \
  http://localhost:4321/metrics/delete

# Admin has role + scope (200)
curl -X POST \
  -H "x-api-key: user-1" \
  -H "Content-Type: application/json" \
  -d '{"id":1}' \
  http://localhost:4321/metrics/delete
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/healthcheck` | Public | Health check |
| GET | `/profile` | Authenticated | User profile |
| GET | `/metrics` | Admin OR Editor | View metrics |
| POST | `/metrics/create` | read:metrics AND write:metrics | Create metric |
| GET | `/secrets` | Admin only | View secrets |
| POST | `/metrics/delete` | Admin + delete:metrics | Delete metric |
| GET | `/dashboard/viewer` | Viewer + read:metrics | Viewer dashboard |
| GET | `/openapi.json` | Public | API documentation |

## Code Structure

- **`src/index.ts`**: Main server with all auth guard examples
- **`src/test.ts`**: Comprehensive test suite (20 test cases)
- **`src/embedded.ts`**: In-process execution examples (no HTTP)
- **`mockDb`**: Hard-coded data (users, metrics, secrets)

## Key Takeaways

## Embedded Execution

Auth guards work identically for in-process/embedded execution (no HTTP server). You can call `api.run()` directly:

```typescript
// Public endpoint - no auth needed
await api.run('public');

// Authenticated endpoint - provide synthetic request
await api.run('profile', {
  request: {
    method: 'POST',
    path: '/profile',
    headers: { 'x-auth-token': 'user-1' },
    query: {},
  },
});

// Bypass auth entirely with custom context
await api.run('adminOnly', {
  context: {
    auth: { userId: 'system', roles: ['admin'] },
    db: mockDb,
  },
});
```

**When to use each approach:**

1. **Synthetic request** - When you want auth strategies to run normally:
   ```typescript
   await api.run('adminOnly', { request: { headers: { ... } } });
   ```

2. **Custom context** - When calling from trusted internal code:
   ```typescript
   await api.run('adminOnly', { context: { auth: systemUser } });
   ```

3. **No auth** - For public endpoints:
   ```typescript
   await api.run('public'); // Works without any params
   ```

See `src/embedded.ts` for a complete working example.

## Key Takeaways

1. **Authentication vs Authorization**: Auth proves WHO you are, guards enforce WHAT you can do
2. **OR Semantics for Roles**: `.requireRole('admin', 'editor')` means admin OR editor
3. **AND Semantics for Scopes**: `.requireScope('read', 'write')` means BOTH required
4. **Type Safety**: `createAuthSystem` catches typos at compile time
5. **Chaining**: Combine multiple guards: `.requireRole().requireScope()`

## Experiment!

Try modifying the auth rules in `src/index.ts`:
- Change role requirements
- Add new scopes
- Create custom guards
- Test error responses
