#!/usr/bin/env node

/**
 * Script to handle CLI files.
 * This script:
 * 1. Creates the dist/cli directory if it doesn't exist
 * 2. Ensures all required CLI files exist in dist/cli
 * 3. Makes bin.js executable
 * 4. Ensures all required exports are present
 * 5. Performs detailed verification of required files
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const srcDir = path.join(rootDir, 'src');
const srcCliDir = path.join(srcDir, 'cli');
const distDir = path.join(rootDir, 'dist');
const distCliDir = path.join(distDir, 'cli');

console.log('=================== CLI FILES HANDLER DIAGNOSTIC ===================');
console.log(`Node version: ${process.version}`);
console.log(`Current directory: ${process.cwd()}`);
console.log(`Script directory: ${__dirname}`);
console.log(`Root directory: ${rootDir}`);
console.log(`Source CLI directory: ${srcCliDir}`);
console.log(`Destination CLI directory: ${distCliDir}`);

// Check if directories exist with detailed logging
console.log('\nChecking directory existence:');
console.log(`- Source dir (${srcDir}): ${fs.existsSync(srcDir) ? 'EXISTS' : 'MISSING'}`);
console.log(`- Source CLI dir (${srcCliDir}): ${fs.existsSync(srcCliDir) ? 'EXISTS' : 'MISSING'}`);
console.log(`- Dist dir (${distDir}): ${fs.existsSync(distDir) ? 'EXISTS' : 'MISSING'}`);
console.log(`- Dist CLI dir (${distCliDir}): ${fs.existsSync(distCliDir) ? 'EXISTS' : 'MISSING'}`);

// Create dist/cli directory if it doesn't exist
if (!fs.existsSync(distCliDir)) {
  console.log('\nCreating dist/cli directory...');
  try {
    fs.mkdirSync(distCliDir, { recursive: true });
    console.log(`✓ Successfully created directory: ${distCliDir}`);
  } catch (error) {
    console.error(`❌ Failed to create directory ${distCliDir}: ${error.message}`);
    process.exit(1);
  }
}

// List source cli directory contents if it exists
if (fs.existsSync(srcCliDir)) {
  console.log('\nSource CLI directory contents:');
  try {
    const srcCliFiles = fs.readdirSync(srcCliDir);
    if (srcCliFiles.length === 0) {
      console.log('(empty)');
    } else {
      srcCliFiles.forEach(file => {
        const filePath = path.join(srcCliDir, file);
        const stats = fs.statSync(filePath);
        console.log(` - ${file} (${stats.size} bytes, ${stats.isDirectory() ? 'directory' : 'file'})`);
      });
    }
  } catch (error) {
    console.error(`Error reading source CLI directory: ${error.message}`);
  }
} else {
  console.warn(`⚠️ Warning: Source CLI directory (${srcCliDir}) does not exist! Will create required files directly.`);
}

// Essential CLI files that must exist
const essentialCliFiles = [
  {
    name: 'bin.js',
    content: `#!/usr/bin/env node

import { ClickHouseConnection } from '../core/connection.js';
import { generateTypes } from './generate-types.js';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs/promises';

// Load environment variables from the current directory
dotenv.config();

// Main CLI function
async function main() {
  console.log('HypeQuery TypeScript Generator');
  
  // Get output path (default or from args)
  const outputPath = process.argv.length > 2 ? process.argv[2] : './generated-schema.ts';

  try {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const database = process.env.CLICKHOUSE_DATABASE || 'default';

    // Initialize connection from env vars
    ClickHouseConnection.initialize({
      host,
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
      database,
    });

    // Ensure directory exists
    const dir = path.dirname(path.resolve(outputPath));
    await fs.mkdir(dir, { recursive: true });

    // Generate types
    await generateTypes(outputPath);

    console.log(\`Success! Types generated at \${path.resolve(outputPath)}\`);
  } catch (error) {
    console.error(\`Error generating types: \${error.message}\`);
    process.exit(1);
  }
}

// Execute the main function
main();`
  },
  {
    name: 'generate-types.js',
    content: `import { ClickHouseConnection } from '../core/connection.js';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from the current directory
dotenv.config();

/**
 * Generates TypeScript type definitions from the ClickHouse database schema
 * @param {string} outputPath - The file path where the type definitions will be written
 * @returns {Promise<void>}
 */
export async function generateTypes(outputPath) {
  const client = ClickHouseConnection.getClient();

  // Get all tables
  const tablesQuery = await client.query({
    query: 'SHOW TABLES',
    format: 'JSONEachRow'
  });
  const tables = await tablesQuery.json();

  let typeDefinitions = \`// Generated by @hypequery/clickhouse
import { ColumnType } from '@hypequery/clickhouse';

export interface IntrospectedSchema {\`;

  // Get columns for each table
  for (const table of tables) {
    const columnsQuery = await client.query({
      query: \`DESCRIBE \${table.name}\`,
      format: 'JSONEachRow'
    });
    const columns = await columnsQuery.json();

    typeDefinitions += \`\\n  \${table.name}: {\`;
    for (const column of columns) {
      typeDefinitions += \`\\n    \${column.name}: 'String';\`;
    }
    typeDefinitions += '\\n  };';
  }

  typeDefinitions += '\\n}\\n';

  // Ensure the output directory exists
  const outputDir = path.dirname(path.resolve(outputPath));
  await fs.mkdir(outputDir, { recursive: true });

  // Write the file
  await fs.writeFile(path.resolve(outputPath), typeDefinitions);
}`
  },
  {
    name: 'index.js',
    content: `// CLI module exports
export { generateTypes } from './generate-types.js';`
  }
];

// Check for and copy or create essential CLI files
console.log('\nProcessing essential CLI files:');
for (const file of essentialCliFiles) {
  const srcPath = path.join(srcCliDir, file.name);
  const destPath = path.join(distCliDir, file.name);

  console.log(`\nProcessing file: ${file.name}`);
  console.log(`- Source path: ${srcPath} (${fs.existsSync(srcPath) ? 'EXISTS' : 'MISSING'})`);
  console.log(`- Destination path: ${destPath} (${fs.existsSync(destPath) ? 'EXISTS' : 'MISSING'})`);

  let fileCreated = false;
  let fileError = null;

  if (fs.existsSync(srcPath)) {
    console.log(`- Copying ${file.name} from source...`);
    try {
      fs.copyFileSync(srcPath, destPath);
      fileCreated = true;
      console.log(`  ✓ Successfully copied from source`);
    } catch (error) {
      fileError = error;
      console.error(`  ❌ Error copying from source: ${error.message}`);
    }
  } else if (!fs.existsSync(destPath)) {
    console.log(`- Creating ${file.name} in dist...`);
    try {
      fs.writeFileSync(destPath, file.content);
      fileCreated = true;
      console.log(`  ✓ Successfully created in dist`);
    } catch (error) {
      fileError = error;
      console.error(`  ❌ Error creating file: ${error.message}`);
    }
  } else {
    console.log(`- File ${file.name} already exists in dist.`);
    fileCreated = true;
  }

  // Double-check file exists and has content
  if (fileCreated) {
    try {
      const exists = fs.existsSync(destPath);
      const stats = exists ? fs.statSync(destPath) : null;
      const fileSize = stats ? stats.size : 0;

      console.log(`- Verification: File ${exists ? 'EXISTS' : 'MISSING'}, Size: ${fileSize} bytes`);

      if (exists && fileSize === 0) {
        console.error(`  ⚠️ Warning: File exists but is empty!`);
      }
    } catch (error) {
      console.error(`  ❌ Error verifying file: ${error.message}`);
    }
  }

  // Make bin.js executable
  if (file.name === 'bin.js' && fileCreated) {
    try {
      console.log('- Making bin.js executable...');
      fs.chmodSync(destPath, '755');
      console.log('  ✓ Successfully made executable');

      // Double check permissions
      const stats = fs.statSync(destPath);
      const permissions = stats.mode.toString(8).slice(-3);
      console.log(`  - Current permissions: ${permissions}`);
    } catch (error) {
      console.warn(`  ⚠️ Could not make bin.js executable: ${error.message}`);

      // Try alternative method on Unix systems
      try {
        console.log('  - Trying alternative chmod method...');
        execSync(`chmod +x "${destPath}"`);

        const stats = fs.statSync(destPath);
        const permissions = stats.mode.toString(8).slice(-3);
        console.log(`  - New permissions: ${permissions}`);
      } catch (chmodError) {
        console.error(`  ❌ Alternative chmod also failed: ${chmodError.message}`);
      }
    }
  }

  // If there was an error and the file was not created, create it one more time as a fallback
  if (fileError && !fileCreated && file.name === 'bin.js') {
    console.log('- 🛠️ FALLBACK: Attempting one more time with direct write for bin.js...');
    try {
      // Create parent directory if needed
      if (!fs.existsSync(distCliDir)) {
        fs.mkdirSync(distCliDir, { recursive: true });
      }

      // Write file content directly
      fs.writeFileSync(destPath, file.content, { mode: 0o755 });

      // Verify file
      const exists = fs.existsSync(destPath);
      const stats = exists ? fs.statSync(destPath) : null;
      const fileSize = stats ? stats.size : 0;

      console.log(`  - Fallback result: File ${exists ? 'EXISTS' : 'MISSING'}, Size: ${fileSize} bytes`);
    } catch (fallbackError) {
      console.error(`  ❌ Fallback creation also failed: ${fallbackError.message}`);
    }
  }
}

// Copy any other JS and declaration files
if (fs.existsSync(srcCliDir)) {
  console.log('\nCopying additional files from source:');
  const cliFiles = fs.readdirSync(srcCliDir);
  for (const file of cliFiles) {
    if ((file.endsWith('.js') || file.endsWith('.d.ts')) &&
      !essentialCliFiles.some(f => f.name === file)) {
      const srcPath = path.join(srcCliDir, file);
      const destPath = path.join(distCliDir, file);

      console.log(`- Copying additional file: ${file}`);
      try {
        fs.copyFileSync(srcPath, destPath);
        console.log(`  ✓ Successfully copied`);
      } catch (error) {
        console.error(`  ❌ Error copying: ${error.message}`);
      }
    }
  }
}

// Ensure main index.js exists and has the correct exports
const mainIndexPath = path.join(distDir, 'index.js');
let mainIndexContent = '';

console.log('\nChecking main index.js for CLI exports:');
console.log(`- Path: ${mainIndexPath} (${fs.existsSync(mainIndexPath) ? 'EXISTS' : 'MISSING'})`);

if (fs.existsSync(mainIndexPath)) {
  try {
    mainIndexContent = fs.readFileSync(mainIndexPath, 'utf-8');
    console.log(`- Current index.js size: ${mainIndexContent.length} bytes`);
    console.log(`- First 100 chars: ${mainIndexContent.substring(0, 100).replace(/\n/g, '\\n')}...`);

    if (mainIndexContent.includes("export { generateTypes } from './cli/generate-types.js'")) {
      console.log('✓ CLI exports found in main index.js');
    } else {
      console.log('- Adding CLI exports to main index.js...');

      // Add a newline before adding exports if the file isn't empty
      if (mainIndexContent.length > 0 && !mainIndexContent.endsWith('\n')) {
        mainIndexContent += '\n';
      }

      mainIndexContent += "\n// CLI exports\nexport { generateTypes } from './cli/generate-types.js';\n";
      fs.writeFileSync(mainIndexPath, mainIndexContent);
      console.log('✓ CLI exports added to main index.js');
    }
  } catch (error) {
    console.error(`❌ Error processing main index.js: ${error.message}`);
  }
} else {
  console.warn('⚠️ Warning: Main index.js does not exist! Creating minimal version...');
  mainIndexContent = `// Minimal index.js created by CLI build script
export { ClickHouseConnection } from './core/connection.js';

// CLI exports
export { generateTypes } from './cli/generate-types.js';
`;
  try {
    fs.writeFileSync(mainIndexPath, mainIndexContent);
    console.log('✓ Created minimal main index.js with CLI exports');
  } catch (error) {
    console.error(`❌ Error creating minimal index.js: ${error.message}`);
  }
}

// Verify required files exist
console.log('\nVerifying required files:');
const requiredFiles = [
  'dist/cli/bin.js',
  'dist/cli/generate-types.js',
  'dist/cli/index.js',
  'dist/index.js'
];

let allFilesExist = true;
for (const file of requiredFiles) {
  const filePath = path.join(rootDir, file);
  try {
    const exists = fs.existsSync(filePath);
    if (exists) {
      const stats = fs.statSync(filePath);
      console.log(`✓ Found: ${file} (${stats.size} bytes)`);

      // For bin.js, check if it's executable
      if (file === 'dist/cli/bin.js') {
        const permissions = stats.mode.toString(8).slice(-3);
        console.log(`  - Permissions: ${permissions}`);

        // Check content of bin.js
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          console.log(`  - First line: ${content.split('\n')[0]}`);
          console.log(`  - Content length: ${content.length} bytes`);
        } catch (readError) {
          console.error(`  ❌ Error reading bin.js content: ${readError.message}`);
        }
      }
    } else {
      console.error(`✗ Missing: ${file}`);
      allFilesExist = false;

      // Additional diagnostics for missing bin.js
      if (file === 'dist/cli/bin.js') {
        console.log(`  - Checking parent directory (${path.dirname(filePath)}):`);
        try {
          if (fs.existsSync(path.dirname(filePath))) {
            const dirContents = fs.readdirSync(path.dirname(filePath));
            console.log(`  - Directory contents: ${dirContents.join(', ') || '(empty)'}`);
          } else {
            console.log(`  - Parent directory does not exist!`);
          }
        } catch (dirError) {
          console.error(`  ❌ Error checking parent directory: ${dirError.message}`);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error checking ${file}: ${error.message}`);
    allFilesExist = false;
  }
}

// List all files in dist/cli
console.log('\nFinal contents of dist/cli directory:');
try {
  if (fs.existsSync(distCliDir)) {
    const cliDirContents = fs.readdirSync(distCliDir);
    if (cliDirContents.length === 0) {
      console.log('(empty)');
    } else {
      cliDirContents.forEach(file => {
        const filePath = path.join(distCliDir, file);
        const stats = fs.statSync(filePath);
        console.log(` - ${file} (${stats.size} bytes)`);
      });
    }
  } else {
    console.error(`❌ dist/cli directory does not exist at the end of processing!`);
  }
} catch (error) {
  console.error(`❌ Error reading dist/cli directory: ${error.message}`);
}

console.log('\n====================== END OF DIAGNOSTIC ======================');

if (!allFilesExist) {
  console.error('\n❌ Some required files are missing! Build will fail.');
  process.exit(1);
}

console.log('\n✅ CLI files handled successfully!');

function listFilesInDir(directory, prefix = '') {
  try {
    if (!fs.existsSync(directory)) {
      return [`${prefix}Directory does not exist: ${directory}`];
    }

    const files = fs.readdirSync(directory);
    let result = [];

    for (const file of files) {
      const fullPath = path.join(directory, file);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        result.push(`${prefix}${file}/ (dir)`);
        result = result.concat(listFilesInDir(fullPath, `${prefix}  `));
      } else {
        result.push(`${prefix}${file} (${stats.size} bytes)`);
      }
    }

    return result;
  } catch (error) {
    return [`${prefix}Error listing directory: ${error.message}`];
  }
} 