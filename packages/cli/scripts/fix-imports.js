#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '../dist');

/**
 * Fix imports in built files to use @hypequery/clickhouse instead of relative paths
 */
async function fixImports() {
  console.log('Fixing imports in built files...');

  try {
    // Read all .js files in the dist directory
    const files = await fs.readdir(distDir);
    const jsFiles = files.filter(file => file.endsWith('.js'));

    for (const file of jsFiles) {
      const filePath = path.join(distDir, file);
      let content = await fs.readFile(filePath, 'utf8');

      // Replace relative imports with package imports
      content = content.replace(
        /from ['"].*?packages\/clickhouse\/src\/index\.js['"]/g,
        `from '@hypequery/clickhouse'`
      );

      await fs.writeFile(filePath, content);
      console.log(`Fixed imports in ${file}`);
    }

    console.log('All imports fixed successfully!');
  } catch (error) {
    console.error('Error fixing imports:', error);
    process.exit(1);
  }
}

fixImports(); 