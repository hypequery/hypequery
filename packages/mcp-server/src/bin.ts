#!/usr/bin/env node

/**
 * MCP Server CLI
 *
 * This is a standalone executable that starts the MCP server.
 * Users can configure it by creating a config file that exports datasets and executor.
 *
 * Usage:
 *   npx hypequery-mcp --config ./mcp-config.js
 */

import { createMCPServer } from './server.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

async function main() {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');

  if (configIndex === -1 || !args[configIndex + 1]) {
    console.error('Error: --config flag is required');
    console.error('');
    console.error('Usage: hypequery-mcp --config ./mcp-config.js');
    console.error('');
    console.error('The config file should export { datasets, executor }:');
    console.error('');
    console.error('  export const datasets = { ... };');
    console.error('  export const executor = new MetricExecutor(...);');
    process.exit(1);
  }

  const configPath = resolve(process.cwd(), args[configIndex + 1]);

  try {
    // Dynamic import of the config file
    const configModule = await import(pathToFileURL(configPath).href);

    const { datasets, executor } = configModule;

    if (!datasets) {
      throw new Error('Config file must export "datasets"');
    }

    if (!executor) {
      throw new Error('Config file must export "executor"');
    }

    // Create and start the MCP server
    await createMCPServer({
      datasets,
      executor,
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
