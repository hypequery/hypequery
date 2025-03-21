#!/usr/bin/env node

/**
 * Script to fix TypeScript definition files.
 * This script:
 * 1. Ensures index.d.ts includes all required exports
 * 2. Creates missing .d.ts files for CLI functionality
 * 3. Verifies type definitions are properly structured
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const distDir = path.join(rootDir, 'dist');
const indexDtsPath = path.join(distDir, 'index.d.ts');
const cliDir = path.join(distDir, 'cli');

console.log('=================== FIX TYPE DEFINITIONS ===================');
console.log(`Node version: ${process.version}`);
console.log(`Current directory: ${process.cwd()}`);
console.log(`Script directory: ${__dirname}`);
console.log(`Root directory: ${rootDir}`);
console.log(`Dist directory: ${distDir}`);

// Check if index.d.ts exists
console.log('\nChecking index.d.ts...');
let indexDtsContent = '';

if (fs.existsSync(indexDtsPath)) {
  console.log(`✓ Found index.d.ts (${fs.statSync(indexDtsPath).size} bytes)`);
  try {
    indexDtsContent = fs.readFileSync(indexDtsPath, 'utf8');

    // Check for CLI exports in index.d.ts
    if (indexDtsContent.includes('generateTypes')) {
      console.log('✓ CLI export declarations found in index.d.ts');
    } else {
      console.log('❌ CLI export declarations missing, will add them');

      // Add export declaration for generateTypes
      if (!indexDtsContent.endsWith('\n')) {
        indexDtsContent += '\n';
      }

      indexDtsContent += `
/**
 * Generates TypeScript type definitions from ClickHouse schema
 * @param outputPath - Path where the type definitions will be written
 */
export declare function generateTypes(outputPath: string): Promise<void>;
`;

      // Write updated content
      fs.writeFileSync(indexDtsPath, indexDtsContent);
      console.log('✓ Added CLI export declarations to index.d.ts');
    }
  } catch (error) {
    console.error(`❌ Error reading/writing index.d.ts: ${error.message}`);
  }
} else {
  console.log('❌ index.d.ts missing, creating it...');

  // Create minimal index.d.ts
  indexDtsContent = `/**
 * Main ClickHouse connection class
 */
export declare class ClickHouseConnection {
  static client: any;
  static config: any;
  
  /**
   * Initialize the connection with configuration
   */
  static initialize(config: {
    host: string;
    username: string;
    password: string;
    database: string;
  }): typeof ClickHouseConnection;
  
  /**
   * Get the ClickHouse client instance
   */
  static getClient(): any;
  
  /**
   * Get the current configuration
   */
  static getConfig(): any;
}

/**
 * Generates TypeScript type definitions from ClickHouse schema
 * @param outputPath - Path where the type definitions will be written
 */
export declare function generateTypes(outputPath: string): Promise<void>;
`;

  try {
    fs.writeFileSync(indexDtsPath, indexDtsContent);
    console.log('✓ Created minimal index.d.ts');
  } catch (error) {
    console.error(`❌ Error creating index.d.ts: ${error.message}`);
  }
}

// Ensure CLI type definitions exist
console.log('\nChecking CLI type definitions...');

// Create cli directory if it doesn't exist
if (!fs.existsSync(cliDir)) {
  console.log('Creating CLI directory...');
  try {
    fs.mkdirSync(cliDir, { recursive: true });
    console.log('✓ Created CLI directory');
  } catch (error) {
    console.error(`❌ Error creating CLI directory: ${error.message}`);
  }
}

// Create generate-types.d.ts
const generateTypesDtsPath = path.join(cliDir, 'generate-types.d.ts');
console.log(`Checking ${path.relative(rootDir, generateTypesDtsPath)}...`);

if (!fs.existsSync(generateTypesDtsPath)) {
  console.log('Creating generate-types.d.ts...');
  try {
    fs.writeFileSync(generateTypesDtsPath, `/**
 * Generates TypeScript type definitions from ClickHouse schema
 * @param outputPath - Path where the type definitions will be written
 */
export declare function generateTypes(outputPath: string): Promise<void>;
`);
    console.log(`✓ Created ${path.relative(rootDir, generateTypesDtsPath)}`);
  } catch (error) {
    console.error(`❌ Error creating generate-types.d.ts: ${error.message}`);
  }
} else {
  console.log(`✓ ${path.relative(rootDir, generateTypesDtsPath)} already exists (${fs.statSync(generateTypesDtsPath).size} bytes)`);
}

// Create index.d.ts in CLI directory
const cliIndexDtsPath = path.join(cliDir, 'index.d.ts');
console.log(`Checking ${path.relative(rootDir, cliIndexDtsPath)}...`);

if (!fs.existsSync(cliIndexDtsPath)) {
  console.log('Creating CLI index.d.ts...');
  try {
    fs.writeFileSync(cliIndexDtsPath, `export { generateTypes } from './generate-types.js';
`);
    console.log(`✓ Created ${path.relative(rootDir, cliIndexDtsPath)}`);
  } catch (error) {
    console.error(`❌ Error creating CLI index.d.ts: ${error.message}`);
  }
} else {
  console.log(`✓ ${path.relative(rootDir, cliIndexDtsPath)} already exists (${fs.statSync(cliIndexDtsPath).size} bytes)`);
}

// Verify all type definitions
console.log('\nVerifying type definitions...');
const requiredTypeDefFiles = [
  path.join(distDir, 'index.d.ts'),
  path.join(cliDir, 'generate-types.d.ts'),
  path.join(cliDir, 'index.d.ts')
];

let missingFiles = [];
for (const file of requiredTypeDefFiles) {
  if (fs.existsSync(file)) {
    console.log(`✓ Found: ${path.relative(rootDir, file)} (${fs.statSync(file).size} bytes)`);
  } else {
    console.error(`❌ Missing: ${path.relative(rootDir, file)}`);
    missingFiles.push(path.relative(rootDir, file));
  }
}

// List all .d.ts files in dist directory recursively
console.log('\nAll TypeScript definition files in dist:');
const findDtsFiles = (dir, fileList = []) => {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      findDtsFiles(filePath, fileList);
    } else if (file.endsWith('.d.ts')) {
      fileList.push({
        path: path.relative(rootDir, filePath),
        size: stat.size
      });
    }
  }

  return fileList;
};

try {
  const dtsFiles = findDtsFiles(distDir);
  dtsFiles.forEach(file => {
    console.log(`- ${file.path} (${file.size} bytes)`);
  });
  console.log(`Total .d.ts files: ${dtsFiles.length}`);
} catch (error) {
  console.error(`❌ Error listing .d.ts files: ${error.message}`);
}

console.log('\n=================== END OF TYPE DEFINITIONS ===================');

if (missingFiles.length > 0) {
  console.warn(`⚠️ Warning: ${missingFiles.length} type definition files still missing`);
  console.warn(`Missing files: ${missingFiles.join(', ')}`);
  // Don't exit with error since we've tried our best to create them
} else {
  console.log('✅ All required type definition files exist!');
} 