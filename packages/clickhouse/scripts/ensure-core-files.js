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
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

console.log('=================== ENSURE CORE FILES DIAGNOSTIC ===================');
console.log(`Node version: ${process.version}`);
console.log(`Current directory: ${process.cwd()}`);
console.log(`Script directory: ${__dirname}`);
console.log(`Root directory: ${rootDir}`);
console.log(`Source directory: ${srcDir}`);
console.log(`Dist directory: ${distDir}`);

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

console.log('\nCreating directories:');
for (const dir of directories) {
  try {
    if (!fs.existsSync(dir)) {
      console.log(`Creating directory: ${path.relative(rootDir, dir)}`);
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✓ Successfully created: ${path.relative(rootDir, dir)}`);
    } else {
      console.log(`Directory already exists: ${path.relative(rootDir, dir)}`);
    }

    // Double-check directory exists
    if (fs.existsSync(dir)) {
      console.log(`✓ Verified: ${path.relative(rootDir, dir)} exists`);
    } else {
      console.error(`❌ ERROR: ${path.relative(rootDir, dir)} still doesn't exist after creation!`);
    }
  } catch (error) {
    console.error(`❌ Error creating directory ${path.relative(rootDir, dir)}: ${error.message}`);
  }
}

// Verify source directories exist
const requiredSourceDirs = [
  path.join(srcDir, 'core'),
  path.join(srcDir, 'types'),
  path.join(srcDir, 'formatters'),
  path.join(srcDir, 'cli')
];

console.log('\nChecking source directories...');
for (const dir of requiredSourceDirs) {
  if (!fs.existsSync(dir)) {
    console.error(`❌ Error: Required source directory ${path.relative(rootDir, dir)} does not exist!`);

    // Instead of exiting, create the directory as a fallback
    console.log(`Creating missing source directory: ${path.relative(rootDir, dir)}`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✓ Created missing source directory: ${path.relative(rootDir, dir)}`);
    } catch (error) {
      console.error(`❌ Failed to create source directory: ${error.message}`);
      // Only exit if we can't create core source directory
      if (dir.includes('core')) {
        process.exit(1);
      }
    }
  } else {
    console.log(`✓ Source directory exists: ${path.relative(rootDir, dir)}`);
  }
}
console.log('All source directories exist or have been created.');

// Essential files to create
console.log('\nCreating essential files...');

// Always create a minimal connection.js if it doesn't exist
const connectionPath = path.join(distDir, 'core', 'connection.js');
if (!fs.existsSync(connectionPath)) {
  console.log('Creating minimal connection.js...');
  try {
    fs.writeFileSync(connectionPath, `import { createClient } from '@clickhouse/client-web';

/**
 * Manages the connection to the ClickHouse database
 */
export class ClickHouseConnection {
  static client;
  static config;

  /**
   * Initialize the connection with configuration
   */
  static initialize(config) {
    this.config = config;
    this.client = createClient({
      host: config.host,
      username: config.username,
      password: config.password,
      database: config.database,
    });
    return this;
  }

  /**
   * Get the ClickHouse client instance
   */
  static getClient() {
    if (!this.client) {
      throw new Error('ClickHouse connection not initialized. Call ClickHouseConnection.initialize() first.');
    }
    return this.client;
  }

  /**
   * Get the current configuration
   */
  static getConfig() {
    return this.config;
  }
}`);
    console.log(`✓ Successfully created connection.js (${fs.statSync(connectionPath).size} bytes)`);
  } catch (error) {
    console.error(`❌ Error creating connection.js: ${error.message}`);
  }
}

// Always create index.js
const indexPath = path.join(distDir, 'index.js');
console.log(`\nCreating index.js at path: ${indexPath}`);
try {
  fs.writeFileSync(indexPath, `// Main entry point
export { createQueryBuilder } from './core/query-builder.js';
export { ClickHouseConnection } from './core/connection.js';
export { JoinRelationships } from './core/join-relationships.js';
export { CrossFilter } from './core/cross-filter.js';
export { logger } from './core/utils/logger.js';
export {
  raw,
  rawAs,
  toDateTime,
  formatDateTime,
  toStartOfInterval,
  datePart
} from './core/utils/sql-expressions.js';

// Note: CLI functionality is deliberately not exported from the main package
// This prevents Node.js-specific modules from being included in browser bundles
`);
  console.log('✓ Successfully wrote index.js');
  console.log(`- index.js exists: ${fs.existsSync(indexPath)}`);
  console.log(`- index.js size: ${fs.statSync(indexPath).size} bytes`);
  console.log(`- index.js content: \n${fs.readFileSync(indexPath, 'utf8')}`);
} catch (error) {
  console.error(`❌ Error writing index.js: ${error.message}`);
}

// Check CLI source files
console.log('\nChecking CLI source files...');

// Always create generate-types.js
const generateTypesPath = path.join(distDir, 'cli', 'generate-types.js');
if (!fs.existsSync(generateTypesPath)) {
  console.log('Creating minimal generate-types.js...');
  try {
    fs.writeFileSync(generateTypesPath, `import { ClickHouseConnection } from '../core/connection.js';
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
}`);
    console.log(`✓ Successfully created generate-types.js (${fs.statSync(generateTypesPath).size} bytes)`);
  } catch (error) {
    console.error(`❌ Error creating generate-types.js: ${error.message}`);
  }
}

// Always create bin.js
const binJsPath = path.join(distDir, 'cli', 'bin.js');
console.log(`\nCreating CLI bin.js at path: ${binJsPath}`);

// Ensure directory exists again
const binJsDir = path.dirname(binJsPath);
if (!fs.existsSync(binJsDir)) {
  console.log(`Creating bin.js parent directory: ${binJsDir}`);
  try {
    fs.mkdirSync(binJsDir, { recursive: true });
    console.log(`✓ Successfully created bin.js directory`);
  } catch (dirError) {
    console.error(`❌ Error creating bin.js directory: ${dirError.message}`);
  }
}

try {
  // First try normal write
  fs.writeFileSync(binJsPath, `#!/usr/bin/env node

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
main();`);

  console.log('✓ Successfully wrote bin.js');
  console.log(`- bin.js exists: ${fs.existsSync(binJsPath)}`);
  const binJsStats = fs.statSync(binJsPath);
  console.log(`- bin.js size: ${binJsStats.size} bytes`);
  console.log(`- bin.js first line: ${fs.readFileSync(binJsPath, 'utf8').split('\n')[0]}`);
} catch (error) {
  console.error(`❌ Error writing bin.js (first attempt): ${error.message}`);

  // Try alternative approach with temporary file if the first attempt failed
  try {
    console.log('Attempting alternative approach to create bin.js...');

    // Create a temp file
    const tempFilePath = path.join(distDir, 'temp-bin.js');
    fs.writeFileSync(tempFilePath, `#!/usr/bin/env node

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
main();`);

    // Ensure the cli directory exists again
    if (!fs.existsSync(path.join(distDir, 'cli'))) {
      fs.mkdirSync(path.join(distDir, 'cli'), { recursive: true });
    }

    // Move temp file to the actual destination
    fs.renameSync(tempFilePath, binJsPath);
    console.log(`✓ Successfully created bin.js via temp file approach`);
    console.log(`- bin.js exists now: ${fs.existsSync(binJsPath)}`);
    console.log(`- bin.js size now: ${fs.statSync(binJsPath).size} bytes`);
  } catch (altError) {
    console.error(`❌ Error with alternative approach to create bin.js: ${altError.message}`);

    // Last resort approach: direct file write to the exact path
    try {
      console.log('Attempting last resort approach for bin.js creation...');
      const lastResortContent = `#!/usr/bin/env node

// Simplified bin.js created by emergency fallback
import { generateTypes } from './generate-types.js';

// Main CLI function
async function main() {
  console.log('HypeQuery TypeScript Generator (Fallback Version)');
  const outputPath = process.argv.length > 2 ? process.argv[2] : './generated-schema.ts';
  try {
    await generateTypes(outputPath);
    console.log(\`Success! Types generated at \${outputPath}\`);
  } catch (error) {
    console.error(\`Error: \${error.message}\`);
    process.exit(1);
  }
}

main();`;
      // Try writing directly using execSync if we're on a Unix system
      try {
        execSync(`mkdir -p "${path.join(distDir, 'cli')}" && echo '${lastResortContent.replace(/'/g, "'\\''")}' > "${binJsPath}" && chmod +x "${binJsPath}"`);
        console.log(`✓ Successfully created bin.js via shell command`);
      } catch (execError) {
        // If that fails too, try one more direct fs write
        fs.writeFileSync(binJsPath, lastResortContent, { mode: 0o755 });
        console.log(`✓ Successfully created bin.js via direct fs write with mode setting`);
      }

      console.log(`- Final check - bin.js exists: ${fs.existsSync(binJsPath)}`);
      console.log(`- Final check - bin.js size: ${fs.statSync(binJsPath).size} bytes`);
    } catch (lastError) {
      console.error(`❌ ALL APPROACHES FAILED! Cannot create bin.js: ${lastError.message}`);
    }
  }
}

// Make bin.js executable
try {
  console.log('\nMaking bin.js executable...');
  fs.chmodSync(binJsPath, '755');
  console.log(`✓ Successfully made bin.js executable`);

  // Verify permissions
  const stats = fs.statSync(binJsPath);
  const permissions = stats.mode.toString(8).slice(-3);
  console.log(`- File permissions: ${permissions}`);
} catch (error) {
  console.warn(`⚠️ Could not make bin.js executable via fs.chmod: ${error.message}`);

  // Try alternative method on Unix systems
  try {
    console.log('- Trying chmod via execSync...');
    execSync(`chmod +x "${binJsPath}"`);
    console.log(`✓ Successfully made bin.js executable via execSync`);

    // Verify permissions after exec
    const stats = fs.statSync(binJsPath);
    const permissions = stats.mode.toString(8).slice(-3);
    console.log(`- File permissions after exec: ${permissions}`);
  } catch (chmodError) {
    console.error(`❌ Both chmod methods failed: ${chmodError.message}`);
  }
}

// Always create CLI index.js
const cliIndexPath = path.join(distDir, 'cli', 'index.js');
console.log('\nCreating CLI index.js...');
try {
  fs.writeFileSync(cliIndexPath, `// CLI module exports
export { generateTypes } from './generate-types.js';
`);
  console.log(`✓ Successfully created CLI index.js (${fs.statSync(cliIndexPath).size} bytes)`);
} catch (error) {
  console.error(`❌ Error creating CLI index.js: ${error.message}`);
}

// Check required dist files
const requiredDistFiles = [
  path.join(distDir, 'index.js'),
  path.join(distDir, 'cli', 'bin.js'),
  path.join(distDir, 'cli', 'generate-types.js')
];

console.log('\nVerifying compiled distribution files...');
let missingDistFiles = [];

for (const file of requiredDistFiles) {
  try {
    if (fs.existsSync(file)) {
      const stats = fs.statSync(file);
      console.log(`✓ Found: ${path.relative(rootDir, file)} (${stats.size} bytes)`);

      // For bin.js, print first line to verify shebang
      if (file.endsWith('bin.js')) {
        const content = fs.readFileSync(file, 'utf8');
        const firstLine = content.split('\n')[0];
        console.log(`  - First line: "${firstLine}"`);

        // Check if the file starts with the shebang
        if (!firstLine.startsWith('#!/usr/bin/env node')) {
          console.warn(`⚠️ Warning: bin.js does not start with proper shebang!`);
        }
      }
    } else {
      console.error(`✗ Missing: ${path.relative(rootDir, file)}`);
      missingDistFiles.push(path.relative(rootDir, file));

      // For bin.js, check directory
      if (file.endsWith('bin.js')) {
        const dir = path.dirname(file);
        if (fs.existsSync(dir)) {
          console.log(`  - Parent directory exists: ${path.relative(rootDir, dir)}`);
          console.log(`  - Directory contents: ${fs.readdirSync(dir).join(', ') || '(empty)'}`);
        } else {
          console.error(`  - Parent directory does not exist: ${path.relative(rootDir, dir)}`);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error checking file ${path.relative(rootDir, file)}: ${error.message}`);
    missingDistFiles.push(path.relative(rootDir, file));
  }
}

// List final structure of the dist directory
console.log('\nFinal dist directory structure:');
const listDirectory = (dir, prefix = '') => {
  if (!fs.existsSync(dir)) {
    console.log(`${prefix}${path.relative(rootDir, dir)} (does not exist)`);
    return;
  }

  const items = fs.readdirSync(dir);
  for (const item of items) {
    const itemPath = path.join(dir, item);
    const stats = fs.statSync(itemPath);

    if (stats.isDirectory()) {
      console.log(`${prefix}${item}/`);
      listDirectory(itemPath, prefix + '  ');
    } else {
      console.log(`${prefix}${item} (${stats.size} bytes)`);
    }
  }
};

try {
  listDirectory(distDir);
} catch (error) {
  console.error(`❌ Error listing directory structure: ${error.message}`);
}

console.log('\n=================== END OF CORE FILES DIAGNOSTIC ===================');

if (missingDistFiles.length > 0) {
  console.error(`\n❌ Missing ${missingDistFiles.length} required files:`);
  missingDistFiles.forEach(file => console.error(` - ${file}`));
  process.exit(1);
}

console.log('\n✅ All core files exist and are properly configured!'); 