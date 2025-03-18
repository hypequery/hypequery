#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

// Path for the generated test types file from CLI
const TEST_CLI_OUTPUT_PATH = './cli-test-schema.ts';

async function testCli() {
  console.log('Testing types generation CLI...');

  try {
    // Make sure the CLI command is executable
    try {
      execSync('chmod +x ./dist/cli/bin.js');
    } catch (err) {
      console.warn('Could not make bin.js executable:', err.message);
    }

    // Execute the CLI command
    console.log('Executing CLI command...');
    execSync(`node ./dist/cli/bin.js ${TEST_CLI_OUTPUT_PATH}`, {
      stdio: 'inherit',
      env: {
        ...process.env,
        // You can override environment variables here if needed
        // CLICKHOUSE_HOST: 'http://localhost:8123'
      }
    });

    // Check if the file was created
    const fileStats = await fs.stat(TEST_CLI_OUTPUT_PATH);
    if (fileStats.isFile() && fileStats.size > 0) {
      console.log('✅ CLI command executed successfully!');

      // Clean up the test file
      await fs.unlink(TEST_CLI_OUTPUT_PATH);
      console.log('Test file cleaned up.');
    } else {
      console.error('❌ CLI did not generate the output file properly.');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error during CLI test:', error);
    process.exit(1);
  }
}

testCli(); 