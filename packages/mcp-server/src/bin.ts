#!/usr/bin/env node

/**
 * MCP Server CLI
 *
 * This is a standalone executable that starts the MCP server.
 * Users can configure it by creating a config file that exports datasets and analytics.
 *
 * Usage:
 *   npx hypequery-mcp --config ./mcp-config.js
 */

import { createMCPServer } from './server.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import { format } from 'util';

function routeConsoleOutputToStderr(): void {
  const write = (...args: unknown[]) => {
    process.stderr.write(`${format(...args)}\n`);
  };

  // MCP stdio transport owns stdout. Keep application and query logs off the
  // protocol stream, including logs emitted while loading the user's config.
  console.log = write;
  console.info = write;
  console.debug = write;
}

async function main() {
  routeConsoleOutputToStderr();

  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');

  if (configIndex === -1 || !args[configIndex + 1]) {
    console.error('Error: --config flag is required');
    console.error('');
    console.error('Usage: hypequery-mcp --config ./mcp-config.js');
    console.error('');
    console.error('The config file should export { datasets, analytics }:');
    console.error('');
    console.error('  export const datasets = { ... };');
    console.error('  export const analytics = createDatasetClient({ ... });');
    process.exit(1);
  }

  const configPath = resolve(process.cwd(), args[configIndex + 1]);

  try {
    // Dynamic import of the config file
    const configModule = await import(pathToFileURL(configPath).href);

    const { datasets, analytics } = configModule;

    if (!datasets) {
      throw new Error('Config file must export "datasets"');
    }

    if (!analytics) {
      throw new Error('Config file must export "analytics"');
    }

    // Create and start the MCP server
    await createMCPServer({
      datasets,
      analytics,
      name: 'hypequery-mcp-server',
      version: '0.1.0',
    });

    // Keep the process running
    process.on('SIGINT', () => {
      console.error('Shutting down MCP server...');
      process.exit(0);
    });

  } catch (error) {
    console.error('Error loading config file:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
