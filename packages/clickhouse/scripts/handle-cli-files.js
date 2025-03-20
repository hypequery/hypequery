#!/usr/bin/env node

/**
 * Simple script to handle CLI files.
 * This script:
 * 1. Creates the dist/cli directory if it doesn't exist
 * 2. Copies all JavaScript files from src/cli to dist/cli
 * 3. Copies all declaration files (.d.ts) from src/cli to dist/cli
 * 4. Makes bin.js executable
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const srcCliDir = path.join(rootDir, 'src', 'cli');
const distCliDir = path.join(rootDir, 'dist', 'cli');

console.log('Handling CLI files...');

// Create dist/cli directory if it doesn't exist
if (!fs.existsSync(distCliDir)) {
  console.log('Creating dist/cli directory...');
  fs.mkdirSync(distCliDir, { recursive: true });
}

// Check if src/cli directory exists
if (!fs.existsSync(srcCliDir)) {
  console.error(`Error: Source CLI directory (${srcCliDir}) does not exist!`);
  process.exit(1);
}

// Copy JS files and declaration files
const cliFiles = fs.readdirSync(srcCliDir);
for (const file of cliFiles) {
  if (file.endsWith('.js') || file.endsWith('.d.ts')) {
    const srcPath = path.join(srcCliDir, file);
    const destPath = path.join(distCliDir, file);

    console.log(`Copying ${file} to dist/cli...`);
    fs.copyFileSync(srcPath, destPath);

    // Make bin.js executable
    if (file === 'bin.js') {
      try {
        console.log('Making bin.js executable...');
        fs.chmodSync(destPath, '755');
      } catch (error) {
        console.warn('Could not make bin.js executable:', error.message);
      }
    }
  }
}

// Create a basic CLI index.js export if it doesn't exist in src/cli
const cliIndexPath = path.join(distCliDir, 'index.js');
if (!fs.existsSync(cliIndexPath)) {
  console.log('Creating CLI index.js...');
  fs.writeFileSync(cliIndexPath, "export { generateTypes } from './generate-types.js';\n");
}

// Create an export from main index.js to CLI
const mainIndexPath = path.join(rootDir, 'dist', 'index.js');
const mainIndexContent = fs.existsSync(mainIndexPath) ? fs.readFileSync(mainIndexPath, 'utf-8') : '';

if (!mainIndexContent.includes("export { generateTypes } from './cli/generate-types.js'")) {
  console.log('Adding CLI exports to main index.js...');

  // Create main index.js if it doesn't exist
  if (!fs.existsSync(mainIndexPath)) {
    fs.writeFileSync(mainIndexPath, '');
  }

  // Add the export
  fs.appendFileSync(mainIndexPath, "\n// CLI exports\nexport { generateTypes } from './cli/generate-types.js';\n");
}

console.log('CLI files handled successfully!'); 