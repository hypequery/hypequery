import { loadServeDev } from '../utils/load-serve-dev.js';
import { finishAndExit } from '../utils/command-exit.js';
import { CliError } from '../utils/machine-output/cli-error.js';
import { toCliError } from '../utils/machine-output/classify-error.js';
import { isJsonOutput } from '../utils/machine-output/output-mode.js';
import { telemetryErrorCode } from '../utils/telemetry/error-code.js';
import { DevSession } from '../utils/telemetry/dev-session.js';
import { setCommandTelemetryError } from '../utils/telemetry/command-context.js';
import { watch } from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { findApiFileForPath, findQueriesFile } from '../utils/find-files.js';
import { getTableCount } from '../utils/detect-database.js';
import { describeConnectionError } from '../utils/connection-error.js';
import { resolveDevRoutePaths } from '../utils/dev-route-paths.js';
import { loadApiModule } from '../utils/load-api.js';

/**
 * Display error when queries file cannot be found
 */
function displayQueriesFileNotFoundError(commandName: string): void {
  logger.error('Could not find hypequery API file');
  logger.newline();
  logger.info('Expected one of:');
  logger.indent('• hypequery.ts');
  logger.indent('• analytics/api.ts');
  logger.indent('• src/analytics/api.ts');
  logger.indent('• api.ts');
  logger.indent('• src/api.ts');
  logger.indent('• analytics/queries.ts');
  logger.indent('• src/analytics/queries.ts');
  logger.newline();
  logger.info("Did you run 'hypequery init'?");
  logger.newline();
  logger.info('Or specify the file explicitly:');
  logger.indent(`hypequery ${commandName} ./path/to/api.ts`);
  logger.newline();
}

export interface DevOptions {
  port?: number;
  hostname?: string;
  watch?: boolean;
  quiet?: boolean;
  cache?: string;
  redisUrl?: string;
  open?: boolean;
  cors?: boolean;
  path?: string;
}

export async function devCommand(file?: string, options: DevOptions = {}) {
  const telemetry = new DevSession();
  // Step 1: Find queries file
  const queriesFile = file
    ? await findQueriesFile(file)
    : options.path
      ? await findApiFileForPath(options.path)
      : await findQueriesFile();

  if (!queriesFile) {
    displayQueriesFileNotFoundError('dev');
    throw new CliError('NOT_FOUND', 'Could not find a hypequery API file.', {
      reported: true,
      telemetry: 'entrypoint_not_found',
      hint: 'Pass the file explicitly: hypequery dev ./path/to/api.ts (or --path <dir>), or run `hypequery init`.',
    });
  }

  logger.info(`Found: ${path.relative(process.cwd(), queriesFile)}`);
  logger.newline();
  telemetry.start(queriesFile, file, options);

  let currentServer: any = null;
  let ready: DevReadyResult | undefined;
  let startFailure: unknown;
  let lifecycleOperation: Promise<void> = Promise.resolve();
  let shutdownRequested = false;
  const shouldWatch = options.watch !== false; // Default to true

  const queueLifecycleOperation = (operation: () => Promise<void>) => {
    const queued = lifecycleOperation.then(operation, operation);
    lifecycleOperation = queued.catch(() => undefined);
    return queued;
  };

  const stopCurrentRuntime = async () => {
    const server = currentServer;

    // Clear the reference before awaiting teardown so a second signal or
    // restart cannot stop the same server twice.
    currentServer = null;

    if (server) {
      await server.stop();
    }
  };

  const startServer = async () => {
    // Loading spinners for slow operations
    const compileSpinner = ora('Compiling queries...').start();
    const dbSpinner = ora('Connecting to ClickHouse...').start();
    let loading = true;

    try {
      // Before the API module: it imports @hypequery/serve itself, and failing
      // there would hide which package to install.
      const { serveDev } = await loadServeDev();

      // Load the API module
      const api = await loadApiModule(queriesFile);
      loading = false;
      compileSpinner.succeed('Compiled queries');

      // Get table count for display
      let tableCount = 0;
      try {
        tableCount = await getTableCount('clickhouse');
        dbSpinner.succeed(`Connected to ClickHouse (${tableCount} tables)`);
      } catch (error) {
        // Log but don't fail - table count is optional
        dbSpinner.warn('Could not connect to ClickHouse');
        logger.indent(`Reason: ${describeConnectionError(error)}`);
      }

      // Count queries
      const queryCount = Object.keys(api.queries || {}).length;

      logger.header('hypequery dev');

      logger.success(`Registered ${queryCount} ${queryCount === 1 ? 'query' : 'queries'}`);

      logger.newline();

      // Start the server

      currentServer = await serveDev(api, {
        port: options.port,
        hostname: options.hostname,
        quiet: true,
      });

      const address = currentServer.server.address();
      const port = typeof address === 'object' && address ? address.port : options.port || 4000;
      const hostname = options.hostname || 'localhost';
      const baseUrl = `http://${hostname}:${port}`;

      const routePaths = resolveDevRoutePaths(api);
      ready = {
        url: baseUrl,
        hostname,
        port,
        entrypoint: path.resolve(queriesFile),
        docsUrl: `${baseUrl}${routePaths.docs}`,
        openapiUrl: `${baseUrl}${routePaths.openapi}`,
        queries: queryCount,
        watching: shouldWatch,
      };

      const boxLines = [
        `Docs:     ${baseUrl}${routePaths.docs}`,
        `OpenAPI:  ${baseUrl}${routePaths.openapi}`,
      ];
      logger.box(boxLines);

      logger.newline();
      logger.success(`Ready in ${process.uptime().toFixed(0)}ms`);
      logger.newline();

      // Query execution stats are logged automatically
      if (!options.quiet) {
        logger.info('Query execution stats will appear below as requests are made');
        logger.newline();
      }

      if (shouldWatch) {
        logger.info('Watching for changes...');
      }

      // Open browser if requested
      if (options.open) {
        try {
          const open = (await import('open')).default;
          await open(baseUrl);
          logger.success(`Opened ${baseUrl} in browser`);
        } catch {
          // Log but don't fail - browser open is optional
          logger.warn('Could not open browser automatically');
          logger.indent(`Visit: ${baseUrl}`);
        }
      }
      return true;
    } catch (error) {
      const code = loading ? telemetry.loadFailed(error) : telemetryErrorCode(error);
      // If server startup or later setup fails, tear down any resources
      // acquired by this attempt before retrying or exiting.
      try {
        await stopCurrentRuntime();
      } catch (teardownError) {
        const message = teardownError instanceof Error ? teardownError.message : String(teardownError);
        logger.warn(`Failed to clean up dev server resources: ${message}`);
      }

      // Stop spinners if they're still running
      if (compileSpinner.isSpinning) {
        compileSpinner.fail('Failed to compile queries');
      }
      if (dbSpinner.isSpinning) {
        dbSpinner.stop();
      }

      logger.error('Failed to start server');
      logger.newline();
      if (error instanceof Error) {
        logger.info(error.message);
        if (error.stack) {
          logger.newline();
          logger.info('Stack trace:');
          logger.info(error.stack);
        }
      } else {
        logger.info(String(error));
      }
      logger.newline();

      startFailure = error;
      // Without watching, or with --json (an agent cannot wait for an edit),
      // a failed start ends the command.
      if (!shouldWatch || (isJsonOutput() && !ready)) {
        setCommandTelemetryError(code);
        const failure = toCliError(error);
        throw new CliError(failure.code === 'COMMAND_FAILED' ? 'LOAD_FAILED' : failure.code, `Failed to start the dev server: ${failure.message}`, {
          reported: true,
          telemetry: code,
          cause: error,
        });
      }
      return false;
    }
  };

  const restartServer = () =>
    queueLifecycleOperation(async () => {
      if (shutdownRequested) return;
      telemetry.reload();

      if (currentServer) {
        logger.newline();
        logger.reload('File changed, restarting...');
        logger.newline();
        try { await stopCurrentRuntime(); }
        catch (error) { telemetry.reloadFailed(); throw error; }
      }

      if (!shutdownRequested) {
        if (!await startServer()) telemetry.reloadFailed();
      }
    });

  const shutdown = () => {
    if (shutdownRequested) return lifecycleOperation;
    shutdownRequested = true;

    logger.newline();
    logger.info('Shutting down dev server...');

    return queueLifecycleOperation(async () => {
      await stopCurrentRuntime();
      await finishAndExit(0, 'interrupted');
    });
  };

  // Start initial server
  await startServer();

  // Watch for changes
  if (shouldWatch) {
    const watchDir = path.dirname(queriesFile);
    let debounceTimer: NodeJS.Timeout | null = null;

    const watcher = watch(watchDir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;

      // Only watch .ts and .js files
      if (!filename.endsWith('.ts') && !filename.endsWith('.js')) {
        return;
      }

      // Debounce file changes
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(async () => {
        await restartServer();
      }, 100);
    });

    process.once('SIGINT', () => {
      watcher.close();
      shutdown();
    });
    process.once('SIGTERM', () => {
      watcher.close();
      shutdown();
    });
  } else {
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
  // `--json` prints this once the server is listening; the process keeps running.
  return ready ?? { url: null, watching: shouldWatch, error: startFailure instanceof Error ? startFailure.message : null };
}

/** `hypequery dev --json`: printed once the server is listening. */
export interface DevReadyResult {
  readonly url: string;
  readonly hostname: string;
  readonly port: number;
  readonly entrypoint: string;
  readonly docsUrl: string;
  readonly openapiUrl: string;
  readonly queries: number;
  readonly watching: boolean;
}
