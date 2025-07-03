#!/usr/bin/env node

/**
 * Consolidated script to handle all CLI files.
 * This script:
 * 1. Creates the dist/cli directory if it doesn't exist
 * 2. Creates and makes bin.js executable
 * 3. Ensures all required CLI files exist in dist/cli
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

// Create CLI directory if needed
if (!fs.existsSync(distCliDir)) {
  console.log(`Creating CLI directory at ${distCliDir}...`);
  try {
    fs.mkdirSync(distCliDir, { recursive: true });
    console.log(`✅ CLI directory created successfully`);
  } catch (error) {
    console.error(`❌ Failed to create CLI directory: ${error.message}`);

    // Try with shell command as fallback
    try {
      execSync(`mkdir -p "${distCliDir}"`, { stdio: 'inherit' });
      console.log(`✅ CLI directory created via shell command`);
    } catch (shellError) {
      console.error(`❌ Failed to create CLI directory via shell command: ${shellError.message}`);
      process.exit(1);
    }
  }
}

// Process bin.js file
const binJsPath = path.join(distCliDir, 'bin.js');
const binExists = fs.existsSync(binJsPath);
console.log(`Checking for bin.js file...`);

// Standard bin.js content
const binJsContent = `#!/usr/bin/env node

import { ClickHouseConnection } from '../core/connection.js';
import { generateTypes } from './generate-types.js';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs/promises';

// Load environment variables from the current directory
dotenv.config();

// ANSI color codes for prettier output
const colors = {
  reset: '\\x1b[0m',
  bright: '\\x1b[1m',
  dim: '\\x1b[2m',
  green: '\\x1b[32m',
  yellow: '\\x1b[33m',
  blue: '\\x1b[34m',
  red: '\\x1b[31m',
  cyan: '\\x1b[36m'
};

/**
 * Display a colorful banner with the tool name
 */
function showBanner() {
  console.log(\`
\${colors.bright}\${colors.cyan}hypequery TypeScript Generator\${colors.reset}
\${colors.dim}Generate TypeScript types from your ClickHouse database schema\${colors.reset}
  \`);
}

/**
 * Show help information for the CLI
 */
function showHelp() {
  console.log(\`
\${colors.bright}Usage:\${colors.reset}
  npx hypequery-generate-types [output-path] [options]

\${colors.bright}Arguments:\${colors.reset}
  output-path                Path where TypeScript definitions will be saved (default: "./generated-schema.ts")

\${colors.bright}Environment variables:\${colors.reset}
  CLICKHOUSE_HOST            ClickHouse server URL (default: http://localhost:8123)
  CLICKHOUSE_USER            ClickHouse username (default: default)
  CLICKHOUSE_PASSWORD        ClickHouse password
  CLICKHOUSE_DATABASE        ClickHouse database name (default: default)

\${colors.bright}Examples:\${colors.reset}
  npx hypequery-generate-types
  npx hypequery-generate-types ./src/types/db-schema.ts
  CLICKHOUSE_HOST=http://my-clickhouse:8123 npx hypequery-generate-types

\${colors.bright}Options:\${colors.reset}
  --help, -h                 Show this help text
  \`);
}

/**
 * Main CLI function
 */
async function main() {
  showBanner();

  // Process command line arguments
  const args = process.argv.slice(2);

  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  // Get output path (default or from args)
  const outputPath = args.length > 0 && !args[0].startsWith('-')
    ? args[0]
    : './generated-schema.ts';

  try {
    // Display connection info
    const host = process.env.VITE_CLICKHOUSE_HOST || process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const database = process.env.VITE_CLICKHOUSE_DATABASE || process.env.CLICKHOUSE_DATABASE || 'default';

    console.log(\`\${colors.dim}Connecting to ClickHouse at \${colors.reset}\${colors.bright}\${host}\${colors.reset}\`);
    console.log(\`\${colors.dim}Database: \${colors.reset}\${colors.bright}\${database}\${colors.reset}\`);

    // Initialize connection from env vars
    ClickHouseConnection.initialize({
      host,
      username: process.env.VITE_CLICKHOUSE_USER || process.env.CLICKHOUSE_USER || 'default',
      password: process.env.VITE_CLICKHOUSE_PASSWORD || process.env.CLICKHOUSE_PASSWORD,
      database,
    });

    console.log(\`\${colors.dim}Generating TypeScript definitions...\${colors.reset}\`);

    // Ensure directory exists
    const dir = path.dirname(path.resolve(outputPath));
    await fs.mkdir(dir, { recursive: true });

    // Generate types
    await generateTypes(outputPath);

    console.log(\`\${colors.green}✓ Success! \${colors.reset}Types generated at \${colors.bright}\${path.resolve(outputPath)}\${colors.reset}\`);
    console.log(\`
\${colors.dim}To use these types in your project:\${colors.reset}

import { createQueryBuilder } from '@hypequery/clickhouse';
import { IntrospectedSchema } from '\${outputPath.replace(/\\.ts$/, '')}';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});
\`);
  } catch (error) {
    console.error(\`\${colors.red}✗ Error generating types: \${colors.reset}\${error.message}\`);

    // Provide more helpful error messages for common issues
    if (error.message && error.message.includes('ECONNREFUSED')) {
      console.error(\`
\${colors.yellow}Connection refused.\${colors.reset} Please check:
- Is ClickHouse running at \${process.env.CLICKHOUSE_HOST || 'http://localhost:8123'}?
- Do you need to provide authentication credentials?
- Are there any network/firewall restrictions?
\`);
    } else if (error.message && error.message.includes('Authentication failed')) {
      console.error(\`
\${colors.yellow}Authentication failed.\${colors.reset} Please check:
- Are your CLICKHOUSE_USER and CLICKHOUSE_PASSWORD environment variables set correctly?
- Does the user have sufficient permissions?
\`);
    } else if (error.message && error.message.includes('database does not exist')) {
      console.error(\`
\${colors.yellow}Database not found.\${colors.reset} Please check:
- Is the CLICKHOUSE_DATABASE environment variable set correctly?
- Does the database exist in your ClickHouse instance?
\`);
    }

    console.error(\`\${colors.dim}For more information, use --help flag.\${colors.reset}\`);
    process.exit(1);
  }
}

// Execute the main function
main();`;

// Preference for bin.js:
// 1. Use source file if it exists (highest fidelity)
// 2. Create from template if source doesn't exist

if (fs.existsSync(path.join(srcCliDir, 'bin.js'))) {
  console.log('Processing file: bin.js');
  console.log(`- Source path: ${path.join(srcCliDir, 'bin.js')} (EXISTS)`);
  console.log(`- Destination path: ${binJsPath} (${binExists ? 'EXISTS' : 'MISSING'})`);

  console.log('- Copying bin.js from source...');
  try {
    fs.copyFileSync(path.join(srcCliDir, 'bin.js'), binJsPath);
    console.log(`  ✓ Successfully copied from source`);
  } catch (error) {
    console.error(`  ❌ Error copying bin.js: ${error.message}`);
    console.log('  Falling back to template...');

    try {
      fs.writeFileSync(binJsPath, binJsContent, { mode: 0o755 });
      console.log(`  ✓ Successfully created from template`);
    } catch (writeError) {
      console.error(`  ❌ Error creating bin.js from template: ${writeError.message}`);
      process.exit(1);
    }
  }
} else {
  console.log('bin.js not found in source, creating from template...');
  try {
    fs.writeFileSync(binJsPath, binJsContent, { mode: 0o755 });
    console.log(`✓ Successfully created bin.js from template`);
  } catch (error) {
    console.error(`❌ Error creating bin.js: ${error.message}`);
    process.exit(1);
  }
}

// Verification: check file exists
console.log(`- Verification: File ${fs.existsSync(binJsPath) ? 'EXISTS' : 'MISSING'}, Size: ${fs.existsSync(binJsPath) ? fs.statSync(binJsPath).size : 0} bytes`);

// Make bin.js executable
console.log('- Making bin.js executable...');
if (process.platform !== 'win32') {
  try {
    fs.chmodSync(binJsPath, 0o755);
    console.log(`  ✓ Successfully made executable`);
  } catch (error) {
    console.error(`  ❌ Error making bin.js executable: ${error.message}`);
    try {
      execSync(`chmod +x "${binJsPath}"`, { stdio: 'inherit' });
      console.log(`  ✓ Successfully made executable via chmod command`);
    } catch (cmdError) {
      console.error(`  ❌ Error making executable via chmod: ${cmdError.message}`);
    }
  }

  // Verify permissions
  try {
    const permissions = fs.statSync(binJsPath).mode.toString(8);
    console.log(`  - Current permissions: ${permissions}`);
  } catch (error) {
    console.error(`  ❌ Error checking permissions: ${error.message}`);
  }
}

// Process generate-types.js
console.log('\nProcessing file: generate-types.js');
const generateTypesPath = path.join(distCliDir, 'generate-types.js');
const generateTypesExists = fs.existsSync(generateTypesPath);

console.log(`- Source path: ${path.join(srcCliDir, 'generate-types.js')} (${fs.existsSync(path.join(srcCliDir, 'generate-types.js')) ? 'EXISTS' : 'MISSING'})`);
console.log(`- Destination path: ${generateTypesPath} (${generateTypesExists ? 'EXISTS' : 'MISSING'})`);

if (fs.existsSync(path.join(srcCliDir, 'generate-types.js'))) {
  console.log('- Copying generate-types.js from source...');
  try {
    fs.copyFileSync(path.join(srcCliDir, 'generate-types.js'), generateTypesPath);
    console.log(`  ✓ Successfully copied from source`);
  } catch (error) {
    console.error(`  ❌ Error copying generate-types.js: ${error.message}`);
  }
} else {
  console.error('❌ generate-types.js not found in source! This is a required file.');

  // Minimal generate-types.js fallback
  const minimalGenerateTypes = `import { ClickHouseConnection } from '../core/connection.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Minimal implementation of generateTypes
 */
export async function generateTypes(outputPath) {
  const client = ClickHouseConnection.getClient();
  
  // Create a minimal type definition
  const typeDefinitions = \`// Generated by @hypequery/clickhouse
export interface IntrospectedSchema {
  // This is a placeholder. Actual schema introspection failed.
  // Please ensure your ClickHouse connection is properly configured.
  [tableName: string]: {
    [columnName: string]: string;
  };
}
\`;

  // Ensure the output directory exists
  const outputDir = path.dirname(path.resolve(outputPath));
  await fs.mkdir(outputDir, { recursive: true });

  // Write the file
  await fs.writeFile(path.resolve(outputPath), typeDefinitions);
}`;

  try {
    fs.writeFileSync(generateTypesPath, minimalGenerateTypes);
    console.log(`✓ Successfully created minimal generate-types.js (${minimalGenerateTypes.length} bytes)`);
  } catch (error) {
    console.error(`❌ Error creating minimal generate-types.js: ${error.message}`);
    process.exit(1);
  }
}

// Process index.js
console.log('\nProcessing file: index.js');
const cliIndexPath = path.join(distCliDir, 'index.js');

console.log(`- Source path: ${path.join(srcCliDir, 'index.js')} (${fs.existsSync(path.join(srcCliDir, 'index.js')) ? 'EXISTS' : 'MISSING'})`);
console.log(`- Destination path: ${cliIndexPath} (${fs.existsSync(cliIndexPath) ? 'EXISTS' : 'MISSING'})`);

if (fs.existsSync(path.join(srcCliDir, 'index.js'))) {
  console.log('- Copying index.js from source...');
  try {
    fs.copyFileSync(path.join(srcCliDir, 'index.js'), cliIndexPath);
    console.log(`  ✓ Successfully copied from source`);
  } catch (error) {
    console.error(`  ❌ Error copying index.js: ${error.message}`);
  }
} else {
  console.log('index.js not found in source, creating basic version...');

  const cliIndexContent = `export { generateTypes } from './generate-types.js';`;

  try {
    fs.writeFileSync(cliIndexPath, cliIndexContent);
    console.log(`✓ Successfully created CLI index.js (${cliIndexContent.length} bytes)`);
  } catch (error) {
    console.error(`❌ Error creating CLI index.js: ${error.message}`);
  }
}

// Copy any additional TypeScript definition files
console.log('\nCopying additional files from source:');
const additionalFiles = ['generate-types.d.ts', 'index.d.ts'];

for (const file of additionalFiles) {
  const sourcePath = path.join(srcCliDir, file);
  const destPath = path.join(distCliDir, file);

  if (fs.existsSync(sourcePath)) {
    console.log(`- Copying additional file: ${file}`);
    try {
      fs.copyFileSync(sourcePath, destPath);
      console.log(`  ✓ Successfully copied`);
    } catch (error) {
      console.error(`  ❌ Error copying ${file}: ${error.message}`);
    }
  }
}

// Ensure the main index.js has CLI exports
console.log('\nChecking main index.js for CLI exports:');
const mainIndexPath = path.join(distDir, 'index.js');

if (fs.existsSync(mainIndexPath)) {
  console.log(`- Path: ${mainIndexPath} (EXISTS)`);

  try {
    const indexContent = fs.readFileSync(mainIndexPath, 'utf8');
    console.log(`- Current index.js size: ${indexContent.length} bytes`);
    console.log(`- First 100 chars: ${indexContent.substring(0, 100)}...`);

    // Check if index.js contains the comment about not exporting CLI functionality
    if (indexContent.includes('CLI functionality is deliberately not exported')) {
      console.log('✓ Index.js follows the new pattern of not exporting CLI functionality directly');
    } else if (!indexContent.includes('cli/generate-types')) {
      // For backward compatibility, still add the export if it's an older format without the comment
      console.log('- Adding CLI exports to index.js for backward compatibility...');

      // Try to find a good insertion point - after last export
      let newContent;
      if (indexContent.trim().endsWith(';')) {
        newContent = `${indexContent}\n\n// CLI exports\nexport { generateTypes } from './cli/generate-types.js';\n`;
      } else {
        newContent = `${indexContent.trim()}\n\n// CLI exports\nexport { generateTypes } from './cli/generate-types.js';\n`;
      }

      fs.writeFileSync(mainIndexPath, newContent);
      console.log('✓ Added CLI exports to main index.js');
    } else {
      console.log('✓ CLI exports found in main index.js');
    }
  } catch (error) {
    console.error(`❌ Error processing main index.js: ${error.message}`);
  }
} else {
  console.warn(`⚠️ Main index.js not found at ${mainIndexPath}, creating it...`);

  // Create new index.js with the non-CLI-exporting pattern
  const mainIndexContent = `// Main entry point
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
`;

  try {
    fs.writeFileSync(mainIndexPath, mainIndexContent);
    console.log(`✓ Created main index.js without CLI exports for browser compatibility`);
  } catch (error) {
    console.error(`❌ Error creating main index.js: ${error.message}`);
  }
}

// Final verification
console.log('\nVerifying required files:');
const requiredFiles = [
  { path: path.join(distCliDir, 'bin.js'), description: 'CLI binary' },
  { path: path.join(distCliDir, 'generate-types.js'), description: 'Type generator' },
  { path: path.join(distCliDir, 'index.js'), description: 'CLI index' },
  { path: path.join(distDir, 'index.js'), description: 'Main package index' }
];

for (const file of requiredFiles) {
  if (fs.existsSync(file.path)) {
    const stats = fs.statSync(file.path);
    console.log(`✓ Found: ${path.relative(rootDir, file.path)} (${stats.size} bytes)`);

    // Additional checks for bin.js
    if (file.path.endsWith('bin.js')) {
      const content = fs.readFileSync(file.path, 'utf8');
      const firstLine = content.split('\n')[0];
      console.log(`  - First line: "${firstLine}"`);
      console.log(`  - Content length: ${content.length} bytes`);
    }
  } else {
    console.error(`❌ Missing required file: ${path.relative(rootDir, file.path)} (${file.description})`);
    process.exit(1);
  }
}

// List final directory contents
console.log('\nFinal contents of dist/cli directory:');
function listFilesInDir(directory, prefix = '') {
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const fullPath = path.join(directory, file);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      console.log(`${prefix} - ${file}/`);
      listFilesInDir(fullPath, `${prefix}  `);
    } else {
      console.log(`${prefix} - ${file} (${stats.size} bytes)`);
    }
  }
}

listFilesInDir(distCliDir);

console.log('\n====================== END OF DIAGNOSTIC ======================');
console.log('\n✅ CLI files handled successfully!'); 