#!/usr/bin/env node

/**
 * Script to fix ES module imports by adding .js extensions to relative imports.
 * This is needed because TypeScript doesn't automatically add .js extensions
 * when compiling to ES modules, but Node.js requires them.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

console.log('=================== FIX ES MODULE IMPORTS ===================');
console.log(`Node version: ${process.version}`);
console.log(`Dist directory: ${distDir}`);

// Function to recursively find all .js files
function findJsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      findJsFiles(filePath, fileList);
    } else if (file.endsWith('.js')) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

// Function to fix imports in a file
function fixImportsInFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Regex to match relative imports that don't end with .js
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]*\.\.?\/[^'"]*?)(?!\.js)['"]/g;

    // Replace imports
    content = content.replace(importRegex, (match, importPath) => {
      // Skip if it's already a .js file or if it's not a relative path
      if (importPath.endsWith('.js') || !importPath.startsWith('.')) {
        return match;
      }

      // Add .js extension
      const newImportPath = importPath + '.js';
      const newMatch = match.replace(importPath, newImportPath);

      console.log(`  Fixed import: ${importPath} -> ${newImportPath}`);
      modified = true;

      return newMatch;
    });

    if (modified) {
      fs.writeFileSync(filePath, content);
      console.log(`✓ Fixed imports in: ${path.relative(distDir, filePath)}`);
    }

    return modified;
  } catch (error) {
    console.error(`❌ Error processing ${path.relative(distDir, filePath)}: ${error.message}`);
    return false;
  }
}

// Main execution
console.log('\nFinding all .js files...');
const jsFiles = findJsFiles(distDir);
console.log(`Found ${jsFiles.length} .js files`);

let fixedCount = 0;
for (const filePath of jsFiles) {
  if (fixImportsInFile(filePath)) {
    fixedCount++;
  }
}

console.log(`\n=================== SUMMARY ===================`);
console.log(`Total files processed: ${jsFiles.length}`);
console.log(`Files with fixed imports: ${fixedCount}`);
console.log('✅ ES module import fixing complete!'); 