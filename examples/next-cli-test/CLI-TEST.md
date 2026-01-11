# CLI Testing Guide

This Next.js app is set up to test all `@hypequery/serve` CLI commands.

## Available Commands

### 1. Initialize a new API file

```bash
npx hypequery init
```

This creates a `src/hypequery.ts` file with example metrics.

You can also specify a custom path:
```bash
npx hypequery init --file lib/api.ts
```

### 2. Run the dev server

After creating your API file, you need to build it first:
```bash
npm run build
```

Then start the dev server:
```bash
npx hypequery dev
```

Or specify a custom module path:
```bash
npx hypequery dev --module ./lib/api.js --port 4000
```

### 3. Generate SDK client

```bash
npx hypequery sdk --input ./openapi.json --output ./sdk/client.ts --clientName MyApiClient
```

## Testing Workflow

1. Run `npx hypequery init` to create the API file
2. Build the TypeScript: From the project root, rebuild the serve package if you made changes
3. Run `npx hypequery dev` to test the dev server
4. Visit `http://localhost:4000/docs` to see the API docs
5. Test SDK generation with an OpenAPI spec

## Notes

- The package is installed from the local workspace: `file:../../packages/serve`
- Any changes to the serve package require rebuilding it first
- The CLI binary is called `hypequery` (not `hypequery-serve`)
