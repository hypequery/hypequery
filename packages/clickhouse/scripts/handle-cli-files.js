#!/usr/bin/env node

/**
 * Simple script to handle CLI files.
 * This script:
 * 1. Creates the dist/cli directory if it doesn't exist
 * 2. Copies all JavaScript files from src/cli to dist/cli
 * 3. Copies all declaration files (.d.ts) from src/cli to dist/cli
 * 4. Makes bin.js executable
 * 5. Ensures all required exports are present
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const srcCliDir = path.join(rootDir, 'src', 'cli');
const distCliDir = path.join(rootDir, 'dist', 'cli');
const distDir = path.join(rootDir, 'dist');

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

// Ensure main index.js exists and has the correct exports
const mainIndexPath = path.join(distDir, 'index.js');
let mainIndexContent = '';

if (fs.existsSync(mainIndexPath)) {
  mainIndexContent = fs.readFileSync(mainIndexPath, 'utf-8');
}

// Add CLI exports if they're not present
if (!mainIndexContent.includes("export { generateTypes } from './cli/generate-types.js'")) {
  console.log('Adding CLI exports to main index.js...');

  // Add a newline before adding exports if the file isn't empty
  if (mainIndexContent.length > 0 && !mainIndexContent.endsWith('\n')) {
    mainIndexContent += '\n';
  }

  mainIndexContent += "\n// CLI exports\nexport { generateTypes } from './cli/generate-types.js';\n";
  fs.writeFileSync(mainIndexPath, mainIndexContent);
}

// Verify required files exist
const requiredFiles = [
  'dist/cli/bin.js',
  'dist/cli/generate-types.js',
  'dist/cli/index.js',
  'dist/index.js'
];

for (const file of requiredFiles) {
  const filePath = path.join(rootDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: Required file ${file} is missing!`);
    process.exit(1);
  }
}

console.log('CLI files handled successfully!'); 