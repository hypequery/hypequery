#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

/**
 * Fix .d.ts files by adding .js extensions to relative import paths
 * This is needed for Node.js ESM compatibility
 */
async function fixDtsImports() {
  console.log('🔧 Fixing .d.ts import paths for ESM compatibility...');

  try {
    // Find all .d.ts files in the dist directory
    const dtsFiles = await glob('dist/**/*.d.ts', { cwd: process.cwd() });

    let totalFixed = 0;

    for (const file of dtsFiles) {
      const filePath = path.resolve(file);
      let content = await fs.readFile(filePath, 'utf8');
      let modified = false;

      // Fix relative imports by adding .js extension
      // This regex matches relative imports that don't already have an extension
      const importRegex = /from\s+['"](\.\/[^'"]*?)(['"])/g;

      content = content.replace(importRegex, (match, importPath, quote) => {
        // Skip if it already has an extension
        if (importPath.includes('.js') || importPath.includes('.d.ts')) {
          return match;
        }

        // Add .js extension for relative imports
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
          modified = true;
          return `from ${quote}${importPath}.js${quote}`;
        }

        return match;
      });

      if (modified) {
        await fs.writeFile(filePath, content, 'utf8');
        totalFixed++;
        console.log(`  ✅ Fixed: ${file}`);
      }
    }

    console.log(`🎉 Fixed ${totalFixed} .d.ts files`);

  } catch (error) {
    console.error('❌ Error fixing .d.ts imports:', error);
    process.exit(1);
  }
}

// Run the script
fixDtsImports(); 