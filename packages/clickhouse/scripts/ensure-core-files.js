#!/usr/bin/env node

/**
 * Script to ensure core files exist before building.
 * This script:
 * 1. Creates necessary directories if they don't exist
 * 2. Creates core files if they don't exist
 * 3. Verifies all required files are present
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

console.log('Ensuring core files exist...');

// Create necessary directories
const directories = [
  path.join(distDir, 'core'),
  path.join(distDir, 'core', 'features'),
  path.join(distDir, 'core', 'formatters'),
  path.join(distDir, 'core', 'utils'),
  path.join(distDir, 'core', 'validators'),
  path.join(distDir, 'core', 'tests'),
  path.join(distDir, 'core', 'tests', 'integration'),
  path.join(distDir, 'types'),
  path.join(distDir, 'formatters'),
  path.join(distDir, 'cli')
];

for (const dir of directories) {
  if (!fs.existsSync(dir)) {
    console.log(`Creating directory: ${path.relative(rootDir, dir)}`);
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Verify source directories exist
const requiredSourceDirs = [
  path.join(srcDir, 'core'),
  path.join(srcDir, 'types'),
  path.join(srcDir, 'formatters'),
  path.join(srcDir, 'cli')
];

for (const dir of requiredSourceDirs) {
  if (!fs.existsSync(dir)) {
    console.error(`Error: Required source directory ${path.relative(rootDir, dir)} does not exist!`);
    process.exit(1);
  }
}

// Verify core files exist
const requiredCoreFiles = [
  'query-builder.ts',
  'connection.ts',
  'join-relationships.ts',
  'cross-filter.ts',
  'utils/logger.ts',
  'utils/sql-expressions.ts',
  'features/aggregations.ts',
  'features/analytics.ts',
  'features/executor.ts',
  'features/filtering.ts',
  'features/joins.ts',
  'features/pagination.ts',
  'features/query-modifiers.ts',
  'formatters/sql-formatter.ts',
  'validators/filter-validator.ts',
  'validators/value-validator.ts'
];

for (const file of requiredCoreFiles) {
  const srcPath = path.join(srcDir, 'core', file);
  if (!fs.existsSync(srcPath)) {
    console.error(`Error: Required core file ${file} is missing from source!`);
    process.exit(1);
  }
}

// Verify CLI files exist
const requiredCliFiles = [
  'bin.js',
  'generate-types.ts',
  'index.ts'
];

for (const file of requiredCliFiles) {
  const srcPath = path.join(srcDir, 'cli', file);
  if (!fs.existsSync(srcPath)) {
    console.error(`Error: Required CLI file ${file} is missing from source!`);
    process.exit(1);
  }
}

console.log('Core files verified successfully!'); 