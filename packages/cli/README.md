# @hypequery/cli

Command-line interface for Hypequery - the type-safe analytics layer for ClickHouse.

## Quick Start

**No installation required!** Use `npx` to run commands directly:

```bash
# Initialize a new project
npx @hypequery/cli init

# Start development server
npx @hypequery/cli dev

# Generate types from database
npx @hypequery/cli generate
```

## Installation (Optional)

For frequent use, install as a dev dependency:

```bash
npm install -D @hypequery/cli
# or
pnpm add -D @hypequery/cli
# or
yarn add -D @hypequery/cli
```

Then use the shorter `hypequery` command:

```bash
npx hypequery dev
```

Or add to your `package.json` scripts:

```json
{
  "scripts": {
    "hypequery:init": "hypequery init",
    "hypequery:dev": "hypequery dev",
    "hypequery:generate": "hypequery generate"
  }
}
```

## TypeScript Support

If your queries file is TypeScript (`.ts`), the CLI will automatically detect and restart with TypeScript support. Make sure you have `tsx` installed:

```bash
npm install -D tsx
```

The CLI will guide you if `tsx` is needed but not installed.

## Commands

### `hypequery init`

Interactive setup wizard that scaffolds a new Hypequery project.

```bash
# Without installation
npx @hypequery/cli init

# With installation
npx hypequery init
```

**What it does:**
- Connects to your ClickHouse database
- Generates TypeScript types from your schema
- Creates client, queries, and config files
- Sets up `.env` with connection details
- Updates `.gitignore` to protect secrets

**Options:**
- `--database <type>` - Database type (currently only `clickhouse`)
- `--path <path>` - Output directory (default: `analytics/`)
- `--no-example` - Skip example query generation
- `--no-interactive` - Non-interactive mode (uses environment variables)
- `--force` - Overwrite existing files without confirmation

**Example:**
```bash
# Interactive mode (recommended)
npx @hypequery/cli init

# Non-interactive with custom path
npx @hypequery/cli init --path src/analytics --no-interactive
```

### `hypequery dev`

Start development server with live reload and query playground.

```bash
# Without installation
npx @hypequery/cli dev

# With installation
npx hypequery dev

# With TypeScript file
npx @hypequery/cli dev src/analytics/queries.ts
```

**What it does:**
- Starts a local HTTP server for your queries
- Provides interactive API documentation at `/docs`
- Auto-reloads on file changes
- Displays query execution stats

**Options:**
- `-p, --port <port>` - Port number (default: `4000`)
- `-h, --hostname <host>` - Hostname to bind (default: `localhost`)
- `--no-watch` - Disable file watching
- `--cache <provider>` - Cache provider (`memory` | `redis` | `none`)
- `--open` - Open browser automatically
- `--cors` - Enable CORS
- `-q, --quiet` - Suppress startup messages

**Example:**
```bash
# Basic usage
npx @hypequery/cli dev

# Custom port with browser auto-open
npx @hypequery/cli dev --port 3000 --open

# Disable caching for debugging
npx @hypequery/cli dev --cache none
```

**Common Issues:**

If you see "Unexpected token" errors with TypeScript files:
```bash
# Make sure tsx is installed
npm install -D tsx

# The CLI will automatically restart with TypeScript support
npx @hypequery/cli dev
```

### `hypequery generate`

Regenerate TypeScript types from ClickHouse schema.

```bash
# Without installation
npx @hypequery/cli generate

# With installation
npx hypequery generate
```

**What it does:**
- Connects to ClickHouse
- Introspects your database schema
- Generates TypeScript interfaces for all tables
- Updates your schema file with type-safe definitions

**Options:**
- `-o, --output <path>` - Output file (default: `analytics/schema.ts`)
- `--tables <names>` - Only generate for specific tables (comma-separated)
- `--watch` - Watch for schema changes and regenerate automatically

**Example:**
```bash
# Generate all tables
npx @hypequery/cli generate

# Generate specific tables
npx @hypequery/cli generate --tables users,events

# Watch mode for development
npx @hypequery/cli generate --watch --output src/schema.ts
```

### `hypequery create-api-types`

Generate a typed client map (perfect for `@hypequery/react`) from your serve export.

```bash
# Without installation
npx @hypequery/cli create-api-types

# With installation
npx hypequery create-api-types
```

**What it does:**
- Reads your queries file
- Extracts all query definitions
- Generates a TypeScript type map for type-safe client usage
- Perfect for frontend React hooks with `@hypequery/react`

**Options:**
- `[file]` - Path to your queries module (default: auto-detected from `analytics/queries.ts`, `src/analytics/queries.ts`, or `hypequery.ts`)
- `-o, --output <path>` - Output file (default: `<queries-dir>/client.ts`)
- `-n, --name <type>` - Exported type alias name (default: `HypequeryApi`)

**Example:**
```bash
# Auto-detect queries file
npx @hypequery/cli create-api-types

# Specify custom queries file and output
npx @hypequery/cli create-api-types src/queries.ts -o src/api-types.ts

# Custom type name
npx @hypequery/cli create-api-types --name MyApi
```

## Package Scripts

Add these to your `package.json` for easy access:

```json
{
  "scripts": {
    "db:init": "hypequery init",
    "db:dev": "hypequery dev",
    "db:generate": "hypequery generate",
    "db:types": "hypequery create-api-types"
  }
}
```

Then run with:
```bash
npm run db:dev
```

## Documentation

Visit [hypequery.com/docs](https://hypequery.com/docs) for full documentation.

## License

Apache-2.0
