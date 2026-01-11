# @hypequery/cli

Command-line interface for Hypequery - the type-safe analytics layer for ClickHouse.

## Installation

```bash
npm install -D @hypequery/cli
```

## Commands

### `hypequery init`

Interactive setup wizard that scaffolds a new Hypequery project.

```bash
npx hypequery init
```

**Options:**
- `--database <type>` - Database type (clickhouse)
- `--path <path>` - Output directory (default: analytics/)
- `--no-example` - Skip example query generation
- `--no-interactive` - Non-interactive mode (use env vars)
- `--force` - Overwrite existing files

### `hypequery dev`

Start development server with live reload and query playground.

```bash
npx hypequery dev
```

**Options:**
- `-p, --port <port>` - Port number (default: 4000)
- `-h, --hostname <host>` - Hostname to bind (default: localhost)
- `--no-watch` - Disable file watching
- `--cache <provider>` - Cache provider (memory|redis)
- `--open` - Open browser automatically
- `--cors` - Enable CORS
- `-q, --quiet` - Suppress startup messages

### `hypequery generate`

Regenerate TypeScript types from ClickHouse schema.

```bash
npx hypequery generate
```

**Options:**
- `-o, --output <path>` - Output file (default: analytics/schema.ts)
- `--tables <names>` - Only generate for specific tables (comma-separated)
- `--watch` - Watch for schema changes

## Documentation

Visit [hypequery.com/docs](https://hypequery.com/docs) for full documentation.

## License

Apache-2.0
