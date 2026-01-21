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

`hypequery dev` bundles a TypeScript runtime (powered by `tsx`), so pointing it at `analytics/queries.ts` or any `.ts/.tsx` file just works—no extra install or custom runner required. If your project already compiles to JavaScript you can keep targeting the generated `.js` file instead.

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

If you see "Unexpected token" errors while loading your queries, double-check that you're pointing the CLI at the TypeScript source file (e.g. `analytics/queries.ts`). The CLI bundles the loader and should not require additional dependencies.

### `hypequery generate`

Regenerate TypeScript types from ClickHouse schema.

```bash
# Without installation
npx @hypequery/cli generate

# With installation
npx hypequery generate
```

The CLI bundles the ClickHouse driver directly, so you can run this command without installing `@hypequery/clickhouse`. Specify `--database <type>` once additional drivers become available.

**What it does:**
- Connects to ClickHouse
- Introspects your database schema
- Generates TypeScript interfaces for all tables
- Updates your schema file with type-safe definitions

**Options:**
- `-o, --output <path>` - Output file (default: `analytics/schema.ts`)
- `--tables <names>` - Only generate for specific tables (comma-separated)
- `--database <type>` - Override detected database (currently only `clickhouse`)

**Example:**
```bash
# Generate all tables
npx @hypequery/cli generate

# Generate specific tables
npx @hypequery/cli generate --tables users,events

# Custom output path
npx @hypequery/cli generate --output src/schema.ts
```

## Package Scripts

Add these to your `package.json` for easy access:

```json
{
  "scripts": {
    "db:init": "hypequery init",
    "db:dev": "hypequery dev",
    "db:generate": "hypequery generate"
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
