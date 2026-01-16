import { watch } from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { findQueriesFile } from '../utils/find-files.js';
import { getTableCount } from '../utils/detect-database.js';
import { loadApiModule } from '../utils/load-api.js';

export interface DevOptions {
  port?: number;
  hostname?: string;
  watch?: boolean;
  quiet?: boolean;
  cache?: string;
  redisUrl?: string;
  open?: boolean;
  cors?: boolean;
}

export async function devCommand(file?: string, options: DevOptions = {}) {
  // Step 1: Find queries file
  const queriesFile = await findQueriesFile(file);

  if (!queriesFile) {
    logger.error('Could not find queries file');
    logger.newline();
    logger.info('Expected one of:');
    logger.indent('• analytics/queries.ts');
    logger.indent('• src/analytics/queries.ts');
    logger.indent('• hypequery.ts');
    logger.newline();
    logger.info("Did you run 'hypequery init'?");
    logger.newline();
    logger.info('Or specify the file explicitly:');
    logger.indent('hypequery dev ./path/to/queries.ts');
    logger.newline();
    process.exit(1);
  }

  logger.info(`Found: ${path.relative(process.cwd(), queriesFile)}`);
  logger.newline();

  let currentServer: any = null;
  const shouldWatch = options.watch !== false; // Default to true

  const startServer = async () => {
    try {
      // Load the API module
      const api = await loadApiModule(queriesFile);

      // Get table count for display
      let tableCount = 0;
      try {
        tableCount = await getTableCount('clickhouse');
      } catch {
        // Ignore errors
      }

      // Count queries
      const queryCount = Object.keys(api.queries || {}).length;

      logger.header('hypequery dev');

      if (tableCount > 0) {
        logger.success(`Schema loaded from ClickHouse (${tableCount} tables)`);
      }
      logger.success(`Registered ${queryCount} ${queryCount === 1 ? 'query' : 'queries'}`);

      if (options.cache !== 'none') {
        const cacheType = options.cache || 'memory';
        logger.success(`Caching enabled (${cacheType})`);
      }

      logger.newline();

      // Start the server
      const { serveDev } = await import('@hypequery/serve');

      currentServer = await serveDev(api, {
        port: options.port,
        hostname: options.hostname,
        quiet: true,
      });

      const address = currentServer.server.address();
      const port = typeof address === 'object' && address ? address.port : options.port || 4000;
      const hostname = options.hostname || 'localhost';
      const baseUrl = `http://${hostname}:${port}`;

      logger.box([
        `Docs:     ${baseUrl}/docs`,
        `OpenAPI:  ${baseUrl}/openapi.json`,
      ]);

      logger.newline();
      logger.success(`Ready in ${process.uptime().toFixed(0)}ms`);
      logger.newline();

      // Query execution stats - coming soon
      logger.info('💡 Query execution stats: Coming soon!');
      logger.newline();

      if (shouldWatch) {
        logger.info('Watching for changes...');
      }

      // Open browser if requested
      if (options.open) {
        try {
          const open = (await import('open')).default;
          await open(baseUrl);
        } catch {
          // open package not available, skip
        }
      }
    } catch (error) {
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

      if (!shouldWatch) {
        process.exit(1);
      }
    }
  };

  const restartServer = async () => {
    if (currentServer) {
      logger.newline();
      logger.reload('File changed, restarting...');
      logger.newline();
      await currentServer.stop();
    }
    await startServer();
  };

  const shutdown = async () => {
    logger.newline();
    logger.info('Shutting down dev server...');
    if (currentServer) {
      await currentServer.stop();
    }
    process.exit(0);
  };

  // Start initial server
  await startServer();

  // Watch for changes
  if (shouldWatch) {
    const watchDir = path.dirname(queriesFile);
    let debounceTimer: NodeJS.Timeout | null = null;

    const watcher = watch(watchDir, { recursive: true }, (eventType, filename) => {
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
}
