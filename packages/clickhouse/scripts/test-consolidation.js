#!/usr/bin/env node

/**
 * Comprehensive test script to verify our build process 
 * works correctly after consolidation.
 * 
 * This script tests:
 * 1. Verifying the source files
 * 2. Clean build
 * 3. Checking generated files
 * 4. Running CLI help command
 * 5. Testing TypeScript exports
 */

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m'
};

// Test steps tracking
const testResults = {
  total: 0,
  passed: 0,
  failed: 0
};

async function runTest(name, testFn) {
  console.log(`\n${colors.blue}${colors.bright}TESTING: ${name}${colors.reset}`);
  console.log('-'.repeat(50));
  testResults.total++;

  try {
    await testFn();
    console.log(`${colors.green}✓ PASSED: ${name}${colors.reset}`);
    testResults.passed++;
    return true;
  } catch (error) {
    console.error(`${colors.red}✗ FAILED: ${name}${colors.reset}`);
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    testResults.failed++;
    return false;
  }
}

async function checkSourceFiles() {
  // Check source CLI files exist
  const requiredSourceFiles = [
    'src/cli/bin.js',
    'src/cli/generate-types.js',
    'src/cli/index.js',
    'src/cli/generate-types.d.ts',
    'src/cli/index.d.ts'
  ];

  for (const file of requiredSourceFiles) {
    const filePath = path.join(rootDir, file);
    await fs.access(filePath);
    console.log(`${colors.green}✓ Source file exists: ${file}${colors.reset}`);
  }

  // Check build scripts exist
  const requiredScripts = [
    'scripts/ensure-core-files.js',
    'scripts/handle-cli-files.js',
    'scripts/test-cli-integration.js'
  ];

  for (const script of requiredScripts) {
    const scriptPath = path.join(rootDir, script);
    await fs.access(scriptPath);
    console.log(`${colors.green}✓ Script exists: ${script}${colors.reset}`);
  }
}

async function cleanBuild() {
  console.log(`${colors.dim}Removing dist directory...${colors.reset}`);
  try {
    await fs.rm(path.join(rootDir, 'dist'), { recursive: true, force: true });
  } catch (error) {
    // If directory doesn't exist, that's fine
  }

  console.log(`${colors.dim}Running build...${colors.reset}`);
  execSync('npm run build', { stdio: 'inherit', cwd: rootDir });
}

async function checkGeneratedFiles() {
  // Check dist structure
  const requiredDistFiles = [
    'dist/cli/bin.js',
    'dist/cli/generate-types.js',
    'dist/cli/index.js',
    'dist/core/connection.js',
    'dist/index.js'
  ];

  for (const file of requiredDistFiles) {
    const filePath = path.join(rootDir, file);
    await fs.access(filePath);
    console.log(`${colors.green}✓ Generated file exists: ${file}${colors.reset}`);
  }

  // Check bin.js is executable
  const binStats = await fs.stat(path.join(rootDir, 'dist/cli/bin.js'));
  const isExecutable = (binStats.mode & 0o111) !== 0;

  if (!isExecutable) {
    throw new Error('bin.js is not executable');
  }
  console.log(`${colors.green}✓ bin.js is executable${colors.reset}`);

  // Check content of index.js for CLI exports
  const indexContent = await fs.readFile(path.join(rootDir, 'dist/index.js'), 'utf-8');
  if (!indexContent.includes("export { generateTypes } from './cli/generate-types.js'")) {
    throw new Error('generateTypes export not found in index.js');
  }
  console.log(`${colors.green}✓ CLI exports are in index.js${colors.reset}`);
}

async function testCliHelpCommand() {
  console.log(`${colors.dim}Testing CLI help command...${colors.reset}`);
  const output = execSync('node ./dist/cli/bin.js --help', { encoding: 'utf-8', cwd: rootDir });

  // Check for key elements in the help output
  const requiredHelpText = [
    'HypeQuery TypeScript Generator',
    'Usage:',
    'npx hypequery-generate-types',
    'Arguments:',
    'output-path',
    'Environment variables:',
    'CLICKHOUSE_HOST',
    'Examples:'
  ];

  for (const text of requiredHelpText) {
    if (!output.includes(text)) {
      throw new Error(`Help output missing required text: ${text}`);
    }
  }

  console.log(`${colors.green}✓ CLI help command works correctly${colors.reset}`);
}

async function testTypeScriptExports() {
  console.log(`${colors.dim}Testing TypeScript exports...${colors.reset}`);

  // Check that TypeScript can resolve the export
  const typeCheckContent = `
// Check TypeScript exports
import { generateTypes } from '../dist/cli/generate-types.js';
console.log('TypeScript export check passed');
`;

  // Write test file
  const testFilePath = path.join(rootDir, 'dist', 'type-check-test.js');
  await fs.writeFile(testFilePath, typeCheckContent);

  try {
    execSync(`node ${testFilePath}`, { encoding: 'utf-8', cwd: rootDir });
    console.log(`${colors.green}✓ TypeScript exports can be imported${colors.reset}`);
  } catch (error) {
    throw new Error(`TypeScript export check failed: ${error.message}`);
  } finally {
    // Clean up test file
    await fs.unlink(testFilePath);
  }
}

async function main() {
  console.log(`${colors.cyan}${colors.bright}COMPREHENSIVE BUILD VALIDATION${colors.reset}`);
  console.log('='.repeat(50));

  try {
    await runTest('Source Files Check', checkSourceFiles);
    await runTest('Clean Build', cleanBuild);
    await runTest('Generated Files Check', checkGeneratedFiles);
    await runTest('CLI Help Command', testCliHelpCommand);
    await runTest('TypeScript Exports', testTypeScriptExports);

    // Final summary
    console.log('\n' + '='.repeat(50));
    console.log(`${colors.bright}TEST SUMMARY:${colors.reset}`);
    console.log(`${colors.green}✓ Passed: ${testResults.passed}/${testResults.total}${colors.reset}`);

    if (testResults.failed > 0) {
      console.log(`${colors.red}✗ Failed: ${testResults.failed}/${testResults.total}${colors.reset}`);
      process.exit(1);
    } else {
      console.log(`\n${colors.green}${colors.bright}ALL TESTS PASSED! Your changes are ready to commit.${colors.reset}`);
    }
  } catch (error) {
    console.error(`\n${colors.red}${colors.bright}TESTING FAILED: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

main(); 