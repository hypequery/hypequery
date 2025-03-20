#!/usr/bin/env node

import { ClickHouseConnection } from '../core/connection.js';
import { generateTypes } from './generate-types.js';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs/promises';

// Load environment variables from the current directory
dotenv.config();

// ANSI color codes for prettier output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

/**
 * Display a colorful banner with the tool name
 */
function showBanner() {
  console.log(`
${colors.bright}${colors.cyan}HypeQuery TypeScript Generator${colors.reset}
${colors.dim}Generate TypeScript types from your ClickHouse database schema${colors.reset}
  `);
}

/**
 * Show help information for the CLI
 */
function showHelp() {
  console.log(`
${colors.bright}Usage:${colors.reset}
  npx hypequery-generate-types [output-path] [options]

${colors.bright}Arguments:${colors.reset}
  output-path                Path where TypeScript definitions will be saved (default: "./generated-schema.ts")

${colors.bright}Environment variables:${colors.reset}
  CLICKHOUSE_HOST            ClickHouse server URL (default: http://localhost:8123)
  CLICKHOUSE_USER            ClickHouse username (default: default)
  CLICKHOUSE_PASSWORD        ClickHouse password
  CLICKHOUSE_DATABASE        ClickHouse database name (default: default)

${colors.bright}Examples:${colors.reset}
  npx hypequery-generate-types
  npx hypequery-generate-types ./src/types/db-schema.ts
  CLICKHOUSE_HOST=http://my-clickhouse:8123 npx hypequery-generate-types

${colors.bright}Options:${colors.reset}
  --help, -h                 Show this help text
  `);
}

/**
 * Main CLI function
 */
async function main() {
  showBanner();

  // Process command line arguments
  const args = process.argv.slice(2);

  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  // Get output path (default or from args)
  const outputPath = args.length > 0 && !args[0].startsWith('-')
    ? args[0]
    : './generated-schema.ts';

  try {
    // Display connection info
    const host = process.env.VITE_CLICKHOUSE_HOST || process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const database = process.env.VITE_CLICKHOUSE_DATABASE || process.env.CLICKHOUSE_DATABASE || 'default';

    console.log(`${colors.dim}Connecting to ClickHouse at ${colors.reset}${colors.bright}${host}${colors.reset}`);
    console.log(`${colors.dim}Database: ${colors.reset}${colors.bright}${database}${colors.reset}`);

    // Initialize connection from env vars
    ClickHouseConnection.initialize({
      host,
      username: process.env.VITE_CLICKHOUSE_USER || process.env.CLICKHOUSE_USER || 'default',
      password: process.env.VITE_CLICKHOUSE_PASSWORD || process.env.CLICKHOUSE_PASSWORD,
      database,
    });

    console.log(`${colors.dim}Generating TypeScript definitions...${colors.reset}`);

    // Ensure directory exists
    const dir = path.dirname(path.resolve(outputPath));
    await fs.mkdir(dir, { recursive: true });

    // Generate types
    await generateTypes(outputPath);

    console.log(`${colors.green}✓ Success! ${colors.reset}Types generated at ${colors.bright}${path.resolve(outputPath)}${colors.reset}`);
    console.log(`
${colors.dim}To use these types in your project:${colors.reset}

import { createQueryBuilder } from '@hypequery/clickhouse';
import { IntrospectedSchema } from '${outputPath.replace(/\.ts$/, '')}';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});
`);
  } catch (error) {
    console.error(`${colors.red}✗ Error generating types: ${colors.reset}${error.message}`);

    // Provide more helpful error messages for common issues
    if (error.message && error.message.includes('ECONNREFUSED')) {
      console.error(`
${colors.yellow}Connection refused.${colors.reset} Please check:
- Is ClickHouse running at ${process.env.CLICKHOUSE_HOST || 'http://localhost:8123'}?
- Do you need to provide authentication credentials?
- Are there any network/firewall restrictions?
`);
    } else if (error.message && error.message.includes('Authentication failed')) {
      console.error(`
${colors.yellow}Authentication failed.${colors.reset} Please check:
- Are your CLICKHOUSE_USER and CLICKHOUSE_PASSWORD environment variables set correctly?
- Does the user have sufficient permissions?
`);
    } else if (error.message && error.message.includes('database does not exist')) {
      console.error(`
${colors.yellow}Database not found.${colors.reset} Please check:
- Is the CLICKHOUSE_DATABASE environment variable set correctly?
- Does the database exist in your ClickHouse instance?
`);
    }

    console.error(`${colors.dim}For more information, use --help flag.${colors.reset}`);
    process.exit(1);
  }
}

// Execute the main function
main(); 