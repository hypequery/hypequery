#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

async function testCliIntegration() {
  console.log(`${colors.cyan}${colors.bright}Testing CLI Integration${colors.reset}`);
  console.log('=======================================');

  try {
    // 1. Check if dist directory exists
    try {
      await fs.access('./dist');
    } catch (error) {
      console.error(`${colors.red}❌ dist directory not found! Please run a build first.${colors.reset}`);
      process.exit(1);
    }

    // 2. Check if CLI files exist
    console.log('Checking CLI files...');

    try {
      await fs.access('./dist/cli/bin.js');
      await fs.access('./dist/cli/generate-types.js');
      await fs.access('./dist/cli/index.js');
      console.log(`${colors.green}✓ CLI files exist${colors.reset}`);
    } catch (error) {
      console.error(`${colors.red}❌ CLI files not found in dist/cli/: ${error.message}${colors.reset}`);
      process.exit(1);
    }

    // 3. Make bin.js executable
    try {
      await fs.chmod('./dist/cli/bin.js', '755');
      console.log(`${colors.green}✓ Made bin.js executable${colors.reset}`);
    } catch (error) {
      console.warn(`${colors.yellow}⚠️ Could not make bin.js executable: ${error.message}${colors.reset}`);
    }

    // 4. Test running with --help flag
    console.log('\nTesting CLI help command...');
    try {
      const output = execSync('node ./dist/cli/bin.js --help', { encoding: 'utf-8' });
      if (output.includes('Usage:') && output.includes('npx hypequery-generate-types')) {
        console.log(`${colors.green}✓ CLI help command works${colors.reset}`);
      } else {
        console.error(`${colors.red}❌ CLI help output doesn't contain expected text${colors.reset}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`${colors.red}❌ Error running CLI help command: ${error.message}${colors.reset}`);
      process.exit(1);
    }

    // 5. Make sure index exports generateTypes function
    console.log('\nChecking dist/index.js exports...');
    try {
      const indexContent = await fs.readFile('./dist/index.js', 'utf-8');
      console.log('Index content:', indexContent);
      if (indexContent.includes("export { generateTypes }") &&
        indexContent.includes("from './cli/generate-types.js'")) {
        console.log(`${colors.green}✓ generateTypes is exported correctly${colors.reset}`);
      } else {
        console.error(`${colors.red}❌ generateTypes export not found in index.js${colors.reset}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`${colors.red}❌ Error checking index.js: ${error.message}${colors.reset}`);
      process.exit(1);
    }

    console.log(`\n${colors.green}${colors.bright}✓ CLI Integration Test Passed!${colors.reset}`);
  } catch (error) {
    console.error(`${colors.red}${colors.bright}❌ CLI Integration Test Failed: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

testCliIntegration(); 