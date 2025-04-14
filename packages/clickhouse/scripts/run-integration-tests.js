#!/usr/bin/env node

/**
 * Script to run integration tests with proper flags to avoid async operation issues.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the path to the current file and project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Get test file(s) from command line args if specified, otherwise run all tests
const args = process.argv.slice(2);
const testFiles = args.length > 0 ? args : ['src/core/tests/integration'];

console.log(`Running integration tests for: ${testFiles.join(', ')}`);

// Use Jest directly with flags to handle async operations properly
const result = spawnSync('npx', [
  'jest',
  ...testFiles,
  '--runInBand',
  '--forceExit',
  '--detectOpenHandles',
  '--config=jest.config.mjs',
  '--testTimeout=30000'
], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: "--experimental-vm-modules --no-warnings",
    DEBUG: 'true'
  }
});

console.log('Integration tests completed.');

// Exit with the same code as the Jest process
process.exit(result.status); 