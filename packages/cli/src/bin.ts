#!/usr/bin/env node

// Use relative path during development, but the package name will be used when published
import { ClickHouseConnection } from '../../../packages/clickhouse/src/index.js';
import { generateTypes } from './generate-types.js';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from the current directory
dotenv.config();

async function main() {
  const outputPath = process.argv[2] || './generated-schema.ts';

  try {
    // Initialize connection from env vars
    ClickHouseConnection.initialize({
      host: process.env.VITE_CLICKHOUSE_HOST || process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      username: process.env.VITE_CLICKHOUSE_USER || process.env.CLICKHOUSE_USER || 'default',
      password: process.env.VITE_CLICKHOUSE_PASSWORD || process.env.CLICKHOUSE_PASSWORD,
      database: process.env.VITE_CLICKHOUSE_DATABASE || process.env.CLICKHOUSE_DATABASE || 'default',
    });

    await generateTypes(outputPath);
    console.log(`✨ Types generated successfully at ${path.resolve(outputPath)}`);
  } catch (error) {
    console.error('Error generating types:', error);
    process.exit(1);
  }
}

main(); 