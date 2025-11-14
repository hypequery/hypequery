# Browser Minimal Example

A minimal example demonstrating how to use `@hypequery/clickhouse` in a browser environment with proper manual client injection.

## Purpose

This example verifies that:
- ✅ The package can be bundled for browsers without errors
- ✅ No Node.js dependencies (like `buffer`) are included in the browser bundle
- ✅ Manual injection with `@clickhouse/client-web` works correctly
- ✅ Query building works in the browser environment

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server (opens at http://localhost:3002)
npm run dev

# Build for production
npm run build
```

## What This Demonstrates

1. **Proper Browser Setup**: Shows the correct way to use HypeQuery in a browser
2. **Manual Client Injection**: Demonstrates using `@clickhouse/client-web` with the query builder
3. **Bundle Verification**: Confirms that the browser bundle doesn't include Node.js-only packages
4. **Type-Safe Queries**: Shows building type-safe queries in the browser

## Key Points

### ✅ Correct Usage (Browser)

```javascript
import { createClient } from '@clickhouse/client-web';
import { createQueryBuilder } from '@hypequery/clickhouse';

// Create web client
const client = createClient({
  host: 'http://localhost:8123'
});

// Create query builder with manual injection
const db = createQueryBuilder({ client });
```

### ❌ Incorrect Usage (Will Cause Errors)

```javascript
// DON'T: Try to use auto-detection in the browser
import { ClickHouseConnection } from '@hypequery/clickhouse';

ClickHouseConnection.initialize({
  host: 'http://localhost:8123'  // This will fail in browsers
});
```

## Expected Behavior

When you run `npm run dev`, you should see:
- ✅ Page loads without console errors
- ✅ Green success message showing successful import
- ✅ Generated SQL query displayed
- ✅ No errors about `buffer`, `process`, or other Node.js modules

If you see errors about Node.js modules, it means there's a browser compatibility issue in the package.

## Troubleshooting

### "Cannot find module 'buffer'" or similar errors

This indicates that Node.js dependencies are being bundled. This should not happen with the current setup. If you see this:

1. Check that you're using the latest version of `@hypequery/clickhouse`
2. Clear your `node_modules` and reinstall: `rm -rf node_modules && npm install`
3. Check the browser console for the full error stack trace

### Connection errors

This example doesn't connect to an actual ClickHouse instance by default. To test real connections:

1. Update the connection details in `main.js`
2. Ensure your ClickHouse instance is accessible from the browser
3. Configure CORS if necessary

## Related Examples

- `example-dashboard` - Full Next.js dashboard with real ClickHouse queries
- `node-starter` - Node.js environment example
