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
${colors.bright}${colors.cyan}hypequery TypeScript Generator${colors.reset}
${colors.dim}Generate TypeScript types from your ClickHouse database schema${colors.reset}
  `);
}

/**
 * Show help information for the CLI
 */
function showHelp() {
  console.log(`
${colors.bright}Usage:${colors.reset}
  npx hypequery-generate-types [options]

${colors.bright}Options:${colors.reset}
  --output=<path>            Path where TypeScript definitions will be saved (default: "./generated-schema.ts")
  --host=<url>               ClickHouse server URL (default: http://localhost:8123)
  --username=<user>          ClickHouse username (default: default)
  --password=<password>      ClickHouse password
  --database=<db>            ClickHouse database name (default: default)
  --include-tables=<tables>  Comma-separated list of tables to include (default: all)
  --exclude-tables=<tables>  Comma-separated list of tables to exclude (default: none)
  --secure                   Use HTTPS/TLS for connection
  --help, -h                 Show this help text

${colors.dim}Note: All options support both formats: --option=value or --option value${colors.reset}

${colors.bright}Environment variables:${colors.reset}
  CLICKHOUSE_HOST            ClickHouse server URL
  VITE_CLICKHOUSE_HOST       Alternative variable for Vite projects
  NEXT_PUBLIC_CLICKHOUSE_HOST Alternative variable for Next.js projects
  
  CLICKHOUSE_USER            ClickHouse username
  VITE_CLICKHOUSE_USER       Alternative variable for Vite projects
  NEXT_PUBLIC_CLICKHOUSE_USER Alternative variable for Next.js projects
  
  CLICKHOUSE_PASSWORD        ClickHouse password
  VITE_CLICKHOUSE_PASSWORD   Alternative variable for Vite projects
  NEXT_PUBLIC_CLICKHOUSE_PASSWORD Alternative variable for Next.js projects
  
  CLICKHOUSE_DATABASE        ClickHouse database name
  VITE_CLICKHOUSE_DATABASE   Alternative variable for Vite projects
  NEXT_PUBLIC_CLICKHOUSE_DATABASE Alternative variable for Next.js projects

${colors.bright}Examples:${colors.reset}
  npx hypequery-generate-types
  npx hypequery-generate-types --output=./src/types/db-schema.ts
  npx hypequery-generate-types --output ./src/types/db-schema.ts
  npx hypequery-generate-types --host=https://your-instance.clickhouse.cloud:8443 --secure
  npx hypequery-generate-types --host http://localhost:8123 --username default --password password --database my_db
  npx hypequery-generate-types --include-tables=users,orders,products
  npx hypequery-generate-types --include-tables users,orders,products
  `);
}

/**
 * Parse command line arguments into a configuration object
 */
function parseArguments(args) {
  const config = {
    output: './generated-schema.ts',
    includeTables: [],
    excludeTables: [],
    secure: false
  };

  // Helper function to extract value from --param=value format
  function getParamValue(arg, paramName) {
    if (arg.startsWith(`${paramName}=`)) {
      return arg.substring(paramName.length + 1); // +1 for the '=' character
    }
    return null;
  }

  // Helper function to get next argument as value
  function getNextArgValue(args, index) {
    return args[index + 1];
  }

  // Parameter handlers map
  const paramHandlers = {
    '--output': (value) => config.output = value,
    '--host': (value) => config.host = value,
    '--username': (value) => config.username = value,
    '--password': (value) => config.password = value,
    '--database': (value) => config.database = value,
    '--include-tables': (value) => config.includeTables = value.split(','),
    '--exclude-tables': (value) => config.excludeTables = value.split(',')
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let handled = false;

    // Handle parameters with values
    for (const [paramName, handler] of Object.entries(paramHandlers)) {
      // Check for --param=value format
      const value = getParamValue(arg, paramName);
      if (value !== null) {
        handler(value);
        handled = true;
        break;
      }

      // Check for --param value format
      if (arg === paramName) {
        const nextValue = getNextArgValue(args, i);
        if (nextValue && !nextValue.startsWith('-')) {
          handler(nextValue);
          i++; // Skip the next argument since we consumed it
          handled = true;
          break;
        }
      }
    }

    // Handle boolean flags
    if (!handled) {
      if (arg === '--secure') {
        config.secure = true;
      } else if (arg === '--help' || arg === '-h') {
        config.showHelp = true;
      } else if (!arg.startsWith('-') && !config.output) {
        // For backwards compatibility, treat the first non-flag argument as the output path
        config.output = arg;
      }
    }
  }

  return config;
}

/**
 * Main CLI function
 */
async function main() {
  showBanner();

  // Process command line arguments
  const args = process.argv.slice(2);
  const config = parseArguments(args);

  // Check for help flag
  if (config.showHelp) {
    showHelp();
    return;
  }

  try {
    // Get connection parameters from args and environment variables
    const host = config.host ||
      process.env.CLICKHOUSE_HOST ||
      process.env.VITE_CLICKHOUSE_HOST ||
      process.env.NEXT_PUBLIC_CLICKHOUSE_HOST ||
      'http://localhost:8123';

    const username = config.username ||
      process.env.CLICKHOUSE_USER ||
      process.env.VITE_CLICKHOUSE_USER ||
      process.env.NEXT_PUBLIC_CLICKHOUSE_USER ||
      'default';

    const password = config.password ||
      process.env.CLICKHOUSE_PASSWORD ||
      process.env.VITE_CLICKHOUSE_PASSWORD ||
      process.env.NEXT_PUBLIC_CLICKHOUSE_PASSWORD;

    const database = config.database ||
      process.env.CLICKHOUSE_DATABASE ||
      process.env.VITE_CLICKHOUSE_DATABASE ||
      process.env.NEXT_PUBLIC_CLICKHOUSE_DATABASE ||
      'default';

    console.log(`${colors.dim}Connecting to ClickHouse at ${colors.reset}${colors.bright}${host}${colors.reset}`);
    console.log(`${colors.dim}Database: ${colors.reset}${colors.bright}${database}${colors.reset}`);

    // Configure connection
    const connectionConfig = {
      host,
      username,
      password,
      database,
    };

    // Add secure connection options if needed
    if (config.secure || host.startsWith('https://')) {
      connectionConfig.secure = true;
    }

    // Initialize connection
    ClickHouseConnection.initialize(connectionConfig);

    console.log(`${colors.dim}Generating TypeScript definitions...${colors.reset}`);

    // Ensure directory exists
    const dir = path.dirname(path.resolve(config.output));
    await fs.mkdir(dir, { recursive: true });

    // Generate types
    await generateTypes(config.output, {
      includeTables: config.includeTables.length > 0 ? config.includeTables : undefined,
      excludeTables: config.excludeTables.length > 0 ? config.excludeTables : undefined
    });

    console.log(`${colors.green}✓ Success! ${colors.reset}Types generated at ${colors.bright}${path.resolve(config.output)}${colors.reset}`);
    console.log(`
${colors.dim}To use these types in your project:${colors.reset}

import { createQueryBuilder } from '@hypequery/clickhouse';
import { IntrospectedSchema } from '${config.output.replace(/\.ts$/, '')}';

const db = createQueryBuilder<IntrospectedSchema>({
  host: '${host}',
  username: '${username}',
  password: '********',
  database: '${database}'
});
`);
  } catch (error) {
    console.error(`${colors.red}✗ Error generating types: ${colors.reset}${error.message}`);

    // Provide more helpful error messages for common issues
    if (error.message && error.message.includes('ECONNREFUSED')) {
      console.error(`
${colors.yellow}Connection refused.${colors.reset} Please check:
- Is ClickHouse running at the specified host?
- Do you need to provide authentication credentials?
- Are there any network/firewall restrictions?
- For cloud instances, did you include the port (usually 8443) and use HTTPS?
`);
    } else if (error.message && error.message.includes('Authentication failed')) {
      console.error(`
${colors.yellow}Authentication failed.${colors.reset} Please check:
- Are your username and password correct?
- For ClickHouse Cloud, did you use the correct credentials from your cloud dashboard?
- Does the user have sufficient permissions?
`);
    } else if (error.message && error.message.includes('database does not exist')) {
      console.error(`
${colors.yellow}Database not found.${colors.reset} Please check:
- Is the database name correct?
- Does the database exist in your ClickHouse instance?
`);
    } else if (error.message && error.message.includes('certificate')) {
      console.error(`
${colors.yellow}SSL/TLS certificate issue.${colors.reset} For secure connections:
- Try adding the --secure flag
- For ClickHouse Cloud, make sure you're using https:// and port 8443
`);
    }

    console.error(`${colors.dim}For more information, use --help flag.${colors.reset}`);
    process.exit(1);
  }
}

// Execute the main function
main(); 