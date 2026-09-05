import path from 'node:path';
import { format } from 'node:util';
import { findApiFileForPath, findQueriesFile } from '../utils/find-files.js';
import { loadApiModule } from '../utils/load-api.js';
import { logger } from '../utils/logger.js';

/**
 * Mirrors `@hypequery/serve`'s `ServeMcpSource`. Read through the global symbol
 * registry rather than by importing serve: serve is a peer dependency that
 * lives in the user's project, and a static import here would be resolved by
 * Node before any CLI code runs, breaking even `hypequery --help` on a clean
 * install. Keep the key in step with `server/mcp-source.ts`.
 */
const MCP_SOURCE_SYMBOL = Symbol.for('hypequery.mcp-source.v1');

interface ServeMcpSource {
  readonly version: 1;
  readonly datasets: Readonly<Record<string, unknown>>;
  readonly resolveAnalytics: () => unknown;
}

function readServeMcpSource(value: unknown): ServeMcpSource | undefined {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }
  const source = (value as Record<symbol, unknown>)[MCP_SOURCE_SYMBOL] as
    | Partial<ServeMcpSource>
    | undefined;
  return source?.version === 1 && typeof source.resolveAnalytics === 'function'
    ? source as ServeMcpSource
    : undefined;
}

export interface McpOptions {
  /** Analytics directory, matching `hypequery dev --path`. */
  path?: string;
  /** Trusted tenant applied to every tenant-scoped dataset. */
  tenant?: string;
  /** Check the entrypoint and exit instead of speaking MCP over stdio. */
  selfTest?: boolean;
}

export interface McpDependencies {
  loadApi?: (file: string) => Promise<unknown>;
  start?: (config: {
    datasets: Record<string, unknown>;
    analytics: unknown;
    tenantId?: string;
  }) => Promise<unknown>;
}

/**
 * MCP speaks its protocol over stdout, so anything an application logs while
 * loading would corrupt the stream. Route it to stderr before importing the
 * entrypoint, not after.
 */
function routeConsoleOutputToStderr(): () => void {
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
  };
  const write = (...args: unknown[]) => {
    process.stderr.write(`${format(...args)}\n`);
  };
  console.log = write;
  console.info = write;
  console.debug = write;
  return () => Object.assign(console, original);
}

function entrypointNotFound(): never {
  logger.error('Could not find a hypequery API file to serve over MCP');
  logger.newline();
  logger.info('Expected one of:');
  for (const candidate of [
    'hypequery.ts', 'analytics/api.ts', 'src/analytics/api.ts',
    'api.ts', 'src/api.ts', 'analytics/queries.ts', 'src/analytics/queries.ts',
  ]) {
    logger.indent(`• ${candidate}`);
  }
  logger.newline();
  logger.info('Or specify the file explicitly:');
  logger.indent('hypequery mcp ./path/to/api.ts');
  logger.newline();
  process.exit(1);
}

function noDatasets(file: string): never {
  logger.error(`${path.relative(process.cwd(), file)} does not register any datasets`);
  logger.newline();
  logger.info('MCP exposes datasets and named metrics, so add them to defineServe:');
  logger.indent('defineServe({ queryBuilder: db, datasets: { orders: Orders } })');
  logger.newline();
  process.exit(1);
}

/** Datasets a caller cannot query unless a trusted tenant is configured. */
function tenantScopedDatasets(datasets: Record<string, unknown>): string[] {
  return Object.entries(datasets)
    .filter(([, dataset]) => {
      const value = dataset as { tenantKey?: unknown; config?: { tenantKey?: unknown } };
      const tenantKey = value?.tenantKey ?? value?.config?.tenantKey;
      return typeof tenantKey === 'string' && tenantKey.length > 0;
    })
    .map(([name]) => name)
    .sort();
}

async function resolveEntrypoint(file: string | undefined, options: McpOptions): Promise<string> {
  const resolved = file
    ? await findQueriesFile(file)
    : options.path
      ? await findApiFileForPath(options.path)
      : await findQueriesFile();
  return resolved ?? entrypointNotFound();
}

function resolveSource(api: unknown, file: string): ServeMcpSource {
  return readServeMcpSource(api) ?? noDatasets(file);
}

export async function mcpCommand(
  file?: string,
  options: McpOptions = {},
  dependencies: McpDependencies = {},
): Promise<void> {
  const restoreConsole = routeConsoleOutputToStderr();
  try {
    const entrypoint = await resolveEntrypoint(file, options);
    const loadApi = dependencies.loadApi ?? loadApiModule;
    const source = resolveSource(await loadApi(entrypoint), entrypoint);
    const datasets = source.datasets as Record<string, unknown>;

    const scoped = tenantScopedDatasets(datasets);
    if (scoped.length > 0 && !options.tenant) {
      // Fail closed rather than serving a tenant-scoped dataset unscoped.
      logger.error(`--tenant is required for tenant-scoped datasets: ${scoped.join(', ')}`);
      logger.newline();
      logger.info('MCP has no request to resolve a tenant from, so it must be given one:');
      logger.indent('hypequery mcp --tenant acme');
      logger.newline();
      process.exit(1);
    }

    const analytics = source.resolveAnalytics();
    const names = Object.keys(datasets).sort();

    if (options.selfTest) {
      logger.success(`Loaded ${path.relative(process.cwd(), entrypoint)}`);
      logger.info(`Datasets: ${names.join(', ')}`);
      logger.info(options.tenant
        ? `Trusted tenant: ${options.tenant}`
        : 'Trusted tenant: none (no dataset is tenant-scoped)');
      logger.newline();
      logger.info('The entrypoint is ready to serve over MCP.');
      return;
    }

    const start = dependencies.start ?? defaultStart;
    await start({
      datasets,
      analytics,
      ...(options.tenant ? { tenantId: options.tenant } : {}),
    });
    // stdout belongs to the MCP transport from here on.
    process.stderr.write(`hypequery MCP serving ${names.length} dataset(s): ${names.join(', ')}\n`);
    await new Promise<void>(resolve => {
      process.on('SIGINT', () => resolve());
      process.on('SIGTERM', () => resolve());
    });
  } finally {
    restoreConsole();
  }
}

async function defaultStart(config: {
  datasets: Record<string, unknown>;
  analytics: unknown;
  tenantId?: string;
}): Promise<unknown> {
  // Imported lazily so `--self-test` and the argument errors above do not pay
  // for the MCP SDK, and so the CLI still loads when it is not installed.
  const { startStdioMCPServer } = await import('@hypequery/mcp');
  return startStdioMCPServer(config as Parameters<typeof startStdioMCPServer>[0]);
}
