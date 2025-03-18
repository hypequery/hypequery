#!/usr/bin/env node

import { ClickHouseConnection } from '../dist/core/connection.js';
import { generateTypes } from '../dist/cli/generate-types.js';
import fs from 'fs/promises';
import path from 'path';

// Path for the generated test types file
const TEST_OUTPUT_PATH = './test-schema.ts';

async function testTypesGeneration() {
  console.log('Testing types generation...');

  try {
    // Initialize connection for testing
    // You can modify these values to match your test environment
    ClickHouseConnection.initialize({
      host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
      database: process.env.CLICKHOUSE_DATABASE || 'default',
    });

    console.log('Generating types...');
    await generateTypes(TEST_OUTPUT_PATH);

    // Check if the file was created
    const fileStats = await fs.stat(TEST_OUTPUT_PATH);
    if (fileStats.isFile() && fileStats.size > 0) {
      console.log('✅ Types generated successfully!');

      // Read and display the first few lines to verify content
      const content = await fs.readFile(TEST_OUTPUT_PATH, 'utf-8');
      const preview = content.split('\n').slice(0, 10).join('\n');
      console.log('\nPreview of generated types:');
      console.log('---------------------------');
      console.log(preview);
      console.log('---------------------------');

      // Clean up the test file
      await fs.unlink(TEST_OUTPUT_PATH);
      console.log('Test file cleaned up.');
    } else {
      console.error('❌ Types file was not generated properly.');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error during types generation test:', error);
    process.exit(1);
  }
}

testTypesGeneration(); 