#!/usr/bin/env node

/**
 * Comprehensive CI diagnostics script
 * This script performs extensive diagnostics to identify issues in CI environments:
 * 1. Checks for required files and their content
 * 2. Verifies file permissions
 * 3. Inspects package configuration
 * 4. Examines TypeScript configuration
 * 5. Outputs detailed logs for debugging
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
const srcDir = path.join(rootDir, 'src');

// Create diagnostics directory
const diagDir = path.join(rootDir, 'ci-diagnostics');
if (!fs.existsSync(diagDir)) {
  fs.mkdirSync(diagDir, { recursive: true });
}

// Setup report file
const reportPath = path.join(diagDir, 'diagnostic-report.txt');
let criticalIssuesFound = false;

// Helper function to append to report
function appendToReport(text) {
  fs.appendFileSync(reportPath, text + '\n');
  console.log(text);
}

// Start diagnostic report
appendToReport('=================== HYPEQUERY CI DIAGNOSTIC REPORT ===================');
appendToReport(`Time: ${new Date().toISOString()}`);
appendToReport(`Node version: ${process.version}`);
appendToReport(`OS: ${process.platform} ${process.arch}`);

// Recursive directory scanner
function scanDirectory(dir, level = 0) {
  if (!fs.existsSync(dir)) {
    appendToReport(`${' '.repeat(level * 2)}${dir} (DOES NOT EXIST)`);
    return;
  }

  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const itemPath = path.join(dir, item);
      const stats = fs.statSync(itemPath);

      if (stats.isDirectory()) {
        appendToReport(`${' '.repeat(level * 2)}📁 ${item}/`);
        scanDirectory(itemPath, level + 1);
      } else {
        const sizeKb = (stats.size / 1024).toFixed(2);
        appendToReport(`${' '.repeat(level * 2)}📄 ${item} (${sizeKb} KB)`);
      }
    }
  } catch (error) {
    appendToReport(`${' '.repeat(level * 2)}❌ Error reading directory: ${error.message}`);
  }
}

// Check directory structure
appendToReport('\n== DIRECTORY STRUCTURE ==');
appendToReport('Source directory structure:');
scanDirectory(srcDir, 1);
appendToReport('\nDist directory structure:');
scanDirectory(distDir, 1);

// Check critical files
appendToReport('\n== CRITICAL FILES CHECK ==');
const criticalFiles = [
  { path: path.join(distDir, 'index.js'), name: 'Main index.js' },
  { path: path.join(distDir, 'index.d.ts'), name: 'TypeScript declarations' },
  { path: path.join(distDir, 'cli', 'bin.js'), name: 'CLI binary entry point' },
  { path: path.join(distDir, 'cli', 'generate-types.js'), name: 'Type generator' },
  { path: path.join(distDir, 'cli', 'index.js'), name: 'CLI index' },
  { path: path.join(distDir, 'core', 'connection.js'), name: 'Core connection' },
  { path: path.join(rootDir, 'package.json'), name: 'Package config' },
  { path: path.join(rootDir, 'tsconfig.json'), name: 'TypeScript config' }
];

for (const file of criticalFiles) {
  if (fs.existsSync(file.path)) {
    const stats = fs.statSync(file.path);
    appendToReport(`✅ ${file.name} exists (${(stats.size / 1024).toFixed(2)} KB)`);

    // Save content of important files to diagnostics
    if (file.path.endsWith('index.js') ||
      file.path.endsWith('bin.js') ||
      file.path.endsWith('package.json') ||
      file.path.endsWith('tsconfig.json')) {
      try {
        const content = fs.readFileSync(file.path, 'utf8');
        const diagnosticFilePath = path.join(diagDir, path.basename(file.path));
        fs.writeFileSync(diagnosticFilePath, content);
        appendToReport(`   Saved content to ${path.basename(diagnosticFilePath)}`);
      } catch (error) {
        appendToReport(`   ❌ Error saving content: ${error.message}`);
      }
    }
  } else {
    appendToReport(`❌ ${file.name} is MISSING!`);
    criticalIssuesFound = true;
  }
}

// Check package configuration
appendToReport('\n== PACKAGE CONFIGURATION ==');
try {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  appendToReport(`Package name: ${packageJson.name}`);
  appendToReport(`Version: ${packageJson.version}`);
  appendToReport(`Main entry: ${packageJson.main}`);
  appendToReport(`Types: ${packageJson.types}`);

  if (packageJson.bin) {
    appendToReport('Binary entries:');
    for (const [name, binPath] of Object.entries(packageJson.bin)) {
      appendToReport(`   ${name}: ${binPath}`);

      // Check if binary path exists
      const fullBinPath = path.join(rootDir, binPath.replace(/^\.\//, ''));
      if (!fs.existsSync(fullBinPath)) {
        appendToReport(`   ❌ Binary file ${fullBinPath} does not exist!`);
        criticalIssuesFound = true;
      }
    }
  }

  if (packageJson.files) {
    appendToReport('Files to include in package:');
    packageJson.files.forEach(file => appendToReport(`   ${file}`));
  }
} catch (error) {
  appendToReport(`❌ Error reading package.json: ${error.message}`);
  criticalIssuesFound = true;
}

// Check TypeScript configuration
appendToReport('\n== TYPESCRIPT CONFIGURATION ==');
try {
  const tsConfig = JSON.parse(fs.readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf8'));
  appendToReport(`Target: ${tsConfig.compilerOptions?.target}`);
  appendToReport(`Module: ${tsConfig.compilerOptions?.module}`);
  appendToReport(`OutDir: ${tsConfig.compilerOptions?.outDir}`);
  appendToReport(`RootDir: ${tsConfig.compilerOptions?.rootDir}`);
  appendToReport(`Declaration: ${tsConfig.compilerOptions?.declaration}`);

  if (tsConfig.include) {
    appendToReport('Includes:');
    tsConfig.include.forEach(inc => appendToReport(`   ${inc}`));
  }

  if (tsConfig.exclude) {
    appendToReport('Excludes:');
    tsConfig.exclude.forEach(exc => appendToReport(`   ${exc}`));
  }
} catch (error) {
  appendToReport(`❌ Error reading tsconfig.json: ${error.message}`);
}

// Get environment info
appendToReport('\n== ENVIRONMENT INFORMATION ==');
try {
  const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
  appendToReport(`npm version: ${npmVersion}`);

  const npmGlobals = execSync('npm list -g --depth=0', { encoding: 'utf8' });
  appendToReport('Global npm packages:');
  appendToReport(npmGlobals);
} catch (error) {
  appendToReport(`Error getting environment info: ${error.message}`);
}

// Check bin.js permissions
appendToReport('\n== CLI BINARY PERMISSIONS ==');
const binJsPath = path.join(distDir, 'cli', 'bin.js');
if (fs.existsSync(binJsPath)) {
  try {
    const stats = fs.statSync(binJsPath);
    const mode = stats.mode.toString(8);
    appendToReport(`bin.js mode: ${mode}`);

    // On Unix systems, check if executable and fix if needed
    if (process.platform !== 'win32') {
      const isExecutable = !!(stats.mode & 0o111);
      appendToReport(`Is executable: ${isExecutable}`);

      if (!isExecutable) {
        appendToReport('Attempting to make bin.js executable...');
        try {
          fs.chmodSync(binJsPath, '755');
          appendToReport('✅ Made bin.js executable');
        } catch (chmodError) {
          appendToReport(`❌ Failed to make executable: ${chmodError.message}`);
          criticalIssuesFound = true;
        }
      }
    }
  } catch (error) {
    appendToReport(`❌ Error checking bin.js permissions: ${error.message}`);
    criticalIssuesFound = true;
  }
} else {
  appendToReport('❌ bin.js does not exist!');
  criticalIssuesFound = true;
}

// Check exports in index.js and index.d.ts
appendToReport('\n== EXPORTS CHECK ==');
try {
  if (fs.existsSync(path.join(distDir, 'index.js'))) {
    const indexContent = fs.readFileSync(path.join(distDir, 'index.js'), 'utf8');
    const hasCLIExports = indexContent.includes("export { generateTypes }");
    appendToReport(`index.js has CLI exports: ${hasCLIExports}`);

    if (!hasCLIExports) {
      appendToReport('❌ Missing CLI exports in index.js!');
      criticalIssuesFound = true;
    }

    // Log number of lines and first/last few lines for context
    const lines = indexContent.split('\n');
    appendToReport(`index.js line count: ${lines.length}`);
    appendToReport('First 5 lines:');
    lines.slice(0, 5).forEach(line => appendToReport(`   ${line}`));
    appendToReport('Last 5 lines:');
    lines.slice(-5).forEach(line => appendToReport(`   ${line}`));
  }

  if (fs.existsSync(path.join(distDir, 'index.d.ts'))) {
    const dtsContent = fs.readFileSync(path.join(distDir, 'index.d.ts'), 'utf8');
    const hasCLIExports = dtsContent.includes("generateTypes");
    appendToReport(`index.d.ts has CLI exports: ${hasCLIExports}`);

    if (!hasCLIExports) {
      appendToReport('❌ Missing CLI exports in index.d.ts!');
      criticalIssuesFound = true;
    }
  }
} catch (error) {
  appendToReport(`❌ Error checking exports: ${error.message}`);
  criticalIssuesFound = true;
}

// Save full diagnostics report
appendToReport('\n== DIAGNOSTIC COMPLETE ==');
if (criticalIssuesFound) {
  appendToReport('❌ CRITICAL ISSUES WERE FOUND! Check the details above.');
} else {
  appendToReport('✅ No critical issues detected.');
}

// Create a zip file of the diagnostics directory if possible
try {
  if (process.platform !== 'win32') {
    execSync(`cd "${rootDir}" && zip -r ci-diagnostics.zip ci-diagnostics`, { stdio: 'inherit' });
    appendToReport('✅ Created ci-diagnostics.zip');
  }
} catch (error) {
  appendToReport(`Failed to create diagnostics zip: ${error.message}`);
}

console.log(`\nDiagnostic report saved to: ${reportPath}`);

// Exit with error if critical issues found
if (criticalIssuesFound) {
  process.exit(1);
} 