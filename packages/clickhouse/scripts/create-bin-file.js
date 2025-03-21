#!/usr/bin/env node

/**
 * Script specifically designed to create the bin.js file
 * This script uses multiple approaches to ensure bin.js is created:
 * 1. Direct file system write
 * 2. File copy from template if available
 * 3. Shell commands as a fallback
 * 4. Makes bin.js executable
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// Setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const cliDir = path.join(distDir, 'cli');
const binFilePath = path.join(cliDir, 'bin.js');

console.log('=================== BIN.JS CREATOR ===================');
console.log(`Time: ${new Date().toISOString()}`);
console.log(`Node version: ${process.version}`);
console.log(`OS: ${process.platform} ${process.arch}`);
console.log(`Root directory: ${rootDir}`);
console.log(`Target bin.js path: ${binFilePath}`);

// Ensure CLI directory exists
if (!fs.existsSync(cliDir)) {
  console.log(`Creating CLI directory at ${cliDir}...`);
  try {
    fs.mkdirSync(cliDir, { recursive: true });
    console.log(`✅ CLI directory created successfully`);
  } catch (error) {
    console.error(`❌ Failed to create CLI directory: ${error.message}`);

    // Try with shell command as fallback
    try {
      execSync(`mkdir -p "${cliDir}"`, { stdio: 'inherit' });
      console.log(`✅ CLI directory created via shell command`);
    } catch (shellError) {
      console.error(`❌ Failed to create CLI directory via shell command: ${shellError.message}`);
      process.exit(1);
    }
  }
}

// Standard bin.js content
const binJsContent = `#!/usr/bin/env node

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
main();`;

// Check if bin.js already exists
const binExists = fs.existsSync(binFilePath);
console.log(`bin.js exists: ${binExists}`);

if (binExists) {
  // Check file size and content
  const stats = fs.statSync(binFilePath);
  console.log(`Current bin.js size: ${stats.size} bytes`);

  if (stats.size === 0) {
    console.log(`bin.js exists but is empty. Will overwrite it.`);
  } else {
    try {
      const firstLine = fs.readFileSync(binFilePath, 'utf8').split('\n')[0];
      console.log(`First line of existing bin.js: ${firstLine}`);

      if (firstLine.startsWith('#!/usr/bin/env node')) {
        console.log(`bin.js appears valid, checking executable permission...`);
      } else {
        console.log(`bin.js exists but does not have proper shebang. Will overwrite.`);
      }
    } catch (error) {
      console.error(`❌ Error reading bin.js: ${error.message}`);
      console.log(`Will attempt to recreate bin.js...`);
    }
  }
}

// Multiple attempts to create bin.js
let success = false;

// Attempt 1: Direct file write with mode
console.log(`\nAttempt 1: Direct file write with mode...`);
try {
  fs.writeFileSync(binFilePath, binJsContent, { mode: 0o755 });
  success = fs.existsSync(binFilePath) && fs.statSync(binFilePath).size > 0;
  console.log(`Attempt 1 ${success ? 'succeeded' : 'failed'}`);
} catch (error) {
  console.error(`Attempt 1 failed: ${error.message}`);
}

// Attempt 2: Write to temp file and then move
if (!success) {
  console.log(`\nAttempt 2: Write to temp file and move...`);
  const tempFile = path.join(distDir, 'temp-bin.js');
  try {
    fs.writeFileSync(tempFile, binJsContent);
    fs.renameSync(tempFile, binFilePath);
    success = fs.existsSync(binFilePath) && fs.statSync(binFilePath).size > 0;
    console.log(`Attempt 2 ${success ? 'succeeded' : 'failed'}`);
  } catch (error) {
    console.error(`Attempt 2 failed: ${error.message}`);
  }
}

// Attempt 3: Use shell echo command to create the file
if (!success && process.platform !== 'win32') {
  console.log(`\nAttempt 3: Use shell echo command...`);
  try {
    // Escape special characters for shell command
    const escapedContent = binJsContent
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');

    execSync(`cat > "${binFilePath}" << 'BINJS_EOF'
${binJsContent}
BINJS_EOF`, { stdio: 'inherit' });

    success = fs.existsSync(binFilePath) && fs.statSync(binFilePath).size > 0;
    console.log(`Attempt 3 ${success ? 'succeeded' : 'failed'}`);
  } catch (error) {
    console.error(`Attempt 3 failed: ${error.message}`);
  }
}

// Attempt 4: Create a minimal version as a last resort
if (!success) {
  console.log(`\nAttempt 4: Create minimal version as last resort...`);
  const minimalBinJs = `#!/usr/bin/env node
console.log("HypeQuery TypeScript Generator (Minimal Version)");
import { generateTypes } from './generate-types.js';
generateTypes(process.argv[2] || './generated-schema.ts').catch(err => {
  console.error(err);
  process.exit(1);
});`;

  try {
    fs.writeFileSync(binFilePath, minimalBinJs, { mode: 0o755 });
    success = fs.existsSync(binFilePath) && fs.statSync(binFilePath).size > 0;
    console.log(`Attempt 4 ${success ? 'succeeded' : 'failed'}`);
  } catch (error) {
    console.error(`Attempt 4 failed: ${error.message}`);
  }
}

// Make bin.js executable
if (success && process.platform !== 'win32') {
  console.log(`\nMaking bin.js executable...`);

  try {
    fs.chmodSync(binFilePath, 0o755);
    console.log(`✅ Made executable via fs.chmod`);
  } catch (chmodError) {
    console.error(`Error making executable via fs.chmod: ${chmodError.message}`);

    try {
      execSync(`chmod +x "${binFilePath}"`, { stdio: 'inherit' });
      console.log(`✅ Made executable via chmod command`);
    } catch (cmdError) {
      console.error(`Error making executable via chmod command: ${cmdError.message}`);
    }
  }

  // Verify permissions
  try {
    const stats = fs.statSync(binFilePath);
    const mode = stats.mode.toString(8);
    const isExecutable = !!(stats.mode & 0o111);
    console.log(`File permissions: ${mode}`);
    console.log(`Is executable: ${isExecutable}`);

    if (!isExecutable) {
      console.warn(`⚠️ WARNING: bin.js still not executable after chmod attempts!`);
    }
  } catch (error) {
    console.error(`Error checking file permissions: ${error.message}`);
  }
}

// Verify bin.js content
if (success) {
  console.log(`\nVerifying bin.js content...`);
  try {
    const content = fs.readFileSync(binFilePath, 'utf8');
    console.log(`bin.js size: ${content.length} bytes`);
    console.log(`First line: ${content.split('\n')[0]}`);
    console.log(`Contains important imports: ${content.includes('ClickHouseConnection') &&
      content.includes('generateTypes')}`);
    console.log(`Contains main function: ${content.includes('main')}`);

    console.log(`\n✅ bin.js successfully created and verified!`);
  } catch (error) {
    console.error(`❌ Error verifying bin.js: ${error.message}`);
    success = false;
  }
} else {
  console.error(`\n❌ All attempts to create bin.js failed!`);
}

// Final status
if (success) {
  console.log('\n=================== BIN.JS CREATOR SUCCEEDED ===================');
} else {
  console.error('\n=================== BIN.JS CREATOR FAILED ===================');
  process.exit(1);
} 