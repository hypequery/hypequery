import { runMcpUntilSignal, type CloseableMcpServer } from '../utils/mcp-lifecycle.js';
import { routeConsoleOutputToStderr } from '../utils/mcp-console.js';
import { readServeMcpSource, tenantScopedDatasets, type ServeMcpSource } from '../utils/mcp-source.js';
import path from 'node:path';
import { findApiFileForPath, findQueriesFile } from '../utils/find-files.js';
import { loadApiModule } from '../utils/load-api.js';
import { logger } from '../utils/logger.js';

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
  }) => Promise<CloseableMcpServer>;
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

    const names = Object.keys(datasets).sort();
    if (names.length === 0) noDatasets(entrypoint);

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
    await runMcpUntilSignal(async () => {
      const server = await start({
        datasets,
        analytics,
        ...(options.tenant ? { tenantId: options.tenant } : {}),
      });
      process.stderr.write(`hypequery MCP serving ${names.length} dataset(s): ${names.join(', ')}\n`);
      return server;
    });
  } finally {
    restoreConsole();
  }
}

async function defaultStart(config: {
  datasets: Record<string, unknown>;
  analytics: unknown;
  tenantId?: string;
}): Promise<CloseableMcpServer> {
  // Imported lazily so `--self-test` and the argument errors above do not pay
  // for the MCP SDK, and so the CLI still loads when it is not installed.
  const { startStdioMCPServer } = await import('@hypequery/mcp');
  return startStdioMCPServer(config as Parameters<typeof startStdioMCPServer>[0]);
}
