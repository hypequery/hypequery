#!/usr/bin/env node

/**
 * Script to verify the build outputs and diagnose any issues.
 * This runs as an additional check after the build process.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

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

console.log(`${colors.cyan}${colors.bright}Verifying Build Outputs${colors.reset}`);
console.log('=============================');

const distDir = path.join(rootDir, 'dist');

// Essential files that must exist for the package to work
const essentialFiles = [
  'index.js',
  'core/connection.js',
  'cli/bin.js',
  'cli/generate-types.js',
  'cli/index.js'
];

// Check if dist directory exists
if (!fs.existsSync(distDir)) {
  console.error(`${colors.red}Error: dist directory does not exist!${colors.reset}`);
  process.exit(1);
}

// Check essential files
console.log('Checking essential files:');
let missingEssentialFiles = [];

for (const file of essentialFiles) {
  const filePath = path.join(distDir, file);
  if (fs.existsSync(filePath)) {
    console.log(`${colors.green}✓ ${file}${colors.reset}`);

    // If this is the index.js file, check its content
    if (file === 'index.js') {
      const content = fs.readFileSync(filePath, 'utf8');

      // We no longer check for CLI exports in index.js since we've deliberately removed them
      // to prevent Node.js-specific modules from being bundled in browser environments
      if (content.includes("export { ClickHouseConnection }") &&
        content.includes("export { createQueryBuilder }")) {
        console.log(`  ${colors.green}✓ index.js includes core exports${colors.reset}`);
      } else {
        console.log(`  ${colors.red}✗ index.js is missing core exports${colors.reset}`);
        printFileContent(filePath, 10);
      }
    }
  } else {
    console.log(`${colors.red}✗ ${file}${colors.reset}`);
    missingEssentialFiles.push(file);
  }
}

if (missingEssentialFiles.length > 0) {
  console.error(`\n${colors.red}Error: ${missingEssentialFiles.length} essential files are missing:${colors.reset}`);
  missingEssentialFiles.forEach(file => console.error(`  - ${file}`));
}

// Check directory structure
console.log('\nChecking directory structure:');
const requiredDirs = [
  'core',
  'cli',
  'types'
];

for (const dir of requiredDirs) {
  const dirPath = path.join(distDir, dir);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    console.log(`${colors.green}✓ ${dir}/ exists${colors.reset}`);

    // List files in this directory
    const files = fs.readdirSync(dirPath);
    console.log(`  Contains ${files.length} files`);
    if (files.length === 0) {
      console.error(`  ${colors.red}Directory is empty!${colors.reset}`);
    } else if (files.length < 5) {
      console.log(`  Files: ${files.join(', ')}`);
    }
  } else {
    console.error(`${colors.red}✗ ${dir}/ is missing${colors.reset}`);
  }
}

// List all files in dist/cli
console.log('\nContents of dist/cli directory:');
const cliDir = path.join(distDir, 'cli');
if (fs.existsSync(cliDir)) {
  const cliFiles = fs.readdirSync(cliDir);
  if (cliFiles.length === 0) {
    console.log(`${colors.yellow}(empty)${colors.reset}`);
  } else {
    cliFiles.forEach(file => {
      console.log(`  - ${file}`);
    });
  }
} else {
  console.error(`${colors.red}dist/cli directory does not exist!${colors.reset}`);
}

// Check the permissions of bin.js
const binJsPath = path.join(distDir, 'cli', 'bin.js');
if (fs.existsSync(binJsPath)) {
  try {
    const stats = fs.statSync(binJsPath);
    const isExecutable = !!(stats.mode & fs.constants.S_IXUSR);
    if (isExecutable) {
      console.log(`\n${colors.green}✓ bin.js is executable${colors.reset}`);
    } else {
      console.log(`\n${colors.yellow}⚠ bin.js is not executable${colors.reset}`);
      console.log('  Will attempt to make it executable...');
      fs.chmodSync(binJsPath, '755');
      console.log('  File mode updated.');
    }
  } catch (error) {
    console.error(`\n${colors.red}Error checking bin.js permissions: ${error.message}${colors.reset}`);
  }
}

// Generate an index of all files
console.log('\nGenerating file index:');
const allFiles = [];

function walkDir(dir, prefix = '') {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const relativePath = path.join(prefix, file);

    if (fs.statSync(filePath).isDirectory()) {
      walkDir(filePath, relativePath);
    } else {
      allFiles.push(relativePath);
    }
  }
}

try {
  walkDir(distDir);
  console.log(`Found ${allFiles.length} files in dist/`);

  // Write the file index to disk for debugging
  const indexPath = path.join(rootDir, 'dist-file-index.txt');
  fs.writeFileSync(indexPath, allFiles.join('\n'));
  console.log(`File index written to ${indexPath}`);
} catch (error) {
  console.error(`${colors.red}Error generating file index: ${error.message}${colors.reset}`);
}

// Helper function to print file content
function printFileContent(filePath, lines = 10) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const contentLines = content.split('\n').slice(0, lines);
    console.log(`  ${colors.dim}First ${lines} lines of ${path.basename(filePath)}:${colors.reset}`);
    contentLines.forEach((line, i) => {
      console.log(`  ${colors.dim}${i + 1}:${colors.reset} ${line}`);
    });
  } catch (error) {
    console.error(`  ${colors.red}Error reading file: ${error.message}${colors.reset}`);
  }
}

// Check for browser compatibility - ensure no static imports of Node.js-only packages
console.log('\nChecking browser compatibility:');
const connectionJsPath = path.join(distDir, 'core', 'connection.js');
let browserCompatibilityIssues = [];

if (fs.existsSync(connectionJsPath)) {
  const content = fs.readFileSync(connectionJsPath, 'utf8');

  // Check for static imports of Node.js-only packages at the top of the file
  // These would cause bundlers to include Node.js dependencies in browser builds
  const nodeOnlyPackages = [
    '@clickhouse/client'
  ];

  // Get the first 10 lines where imports typically are
  const firstLines = content.split('\n').slice(0, 10).join('\n');

  for (const pkg of nodeOnlyPackages) {
    // Check for static import statements (not dynamic require)
    const staticImportPattern = new RegExp(`import\\s+.*from\\s+['"]${pkg}['"]`, 'g');
    const matches = firstLines.match(staticImportPattern);

    if (matches) {
      console.log(`${colors.red}✗ Found static import of Node.js-only package: ${pkg}${colors.reset}`);
      console.log(`  ${colors.yellow}This will cause browser bundling issues!${colors.reset}`);
      console.log(`  ${colors.dim}Matched: ${matches.join(', ')}${colors.reset}`);
      browserCompatibilityIssues.push(`Static import of ${pkg} found in connection.js`);
    }
  }

  // Verify that dynamic require() is present for Node.js client
  if (content.includes("require('@clickhouse/client')")) {
    console.log(`${colors.green}✓ Using dynamic require() for Node.js client${colors.reset}`);
  } else {
    console.log(`${colors.yellow}⚠ No dynamic require() found for @clickhouse/client${colors.reset}`);
    console.log(`  ${colors.dim}This might be intentional if using a different approach${colors.reset}`);
  }

  if (browserCompatibilityIssues.length === 0) {
    console.log(`${colors.green}✓ No browser compatibility issues detected${colors.reset}`);
  }
} else {
  console.error(`${colors.red}✗ connection.js not found for browser compatibility check${colors.reset}`);
  browserCompatibilityIssues.push('connection.js missing');
}

// Print summary
if (missingEssentialFiles.length > 0 || browserCompatibilityIssues.length > 0) {
  console.error(`\n${colors.red}${colors.bright}Build verification failed!${colors.reset}`);
  if (missingEssentialFiles.length > 0) {
    console.error(`${colors.red}${missingEssentialFiles.length} essential files are missing.${colors.reset}`);
  }
  if (browserCompatibilityIssues.length > 0) {
    console.error(`${colors.red}${browserCompatibilityIssues.length} browser compatibility issues found:${colors.reset}`);
    browserCompatibilityIssues.forEach(issue => console.error(`  - ${issue}`));
  }
  process.exit(1);
} else {
  console.log(`\n${colors.green}${colors.bright}Build verification passed!${colors.reset}`);
} 