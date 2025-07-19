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

      // Pattern 1: import statements with relative paths (both ./ and ../)
      const importRegex = /from\s+['"](\.\/[^'"]*?|\.\.\/[^'"]*?)(['"])/g;

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

      // Pattern 2: export statements with relative paths (both ./ and ../)
      const exportRegex = /export\s+\*\s+from\s+['"](\.\/[^'"]*?|\.\.\/[^'"]*?)(['"])/g;

      content = content.replace(exportRegex, (match, importPath, quote) => {
        // Skip if it already has an extension
        if (importPath.includes('.js') || importPath.includes('.d.ts')) {
          return match;
        }

        // Add .js extension for relative exports
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
          modified = true;
          return `export * from ${quote}${importPath}.js${quote}`;
        }

        return match;
      });

      // Pattern 3: export { ... } from statements
      const exportNamedRegex = /export\s+\{[^}]*\}\s+from\s+['"](\.\/[^'"]*?|\.\.\/[^'"]*?)(['"])/g;

      content = content.replace(exportNamedRegex, (match, importPath, quote) => {
        // Skip if it already has an extension
        if (importPath.includes('.js') || importPath.includes('.d.ts')) {
          return match;
        }

        // Add .js extension for relative exports
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
          modified = true;
          return match.replace(`${quote}${importPath}${quote}`, `${quote}${importPath}.js${quote}`);
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