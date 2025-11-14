/**
 * Browser Compatibility Tests
 *
 * These tests ensure that the package can be safely bundled for browser environments
 * without including Node.js-specific dependencies.
 */

import fs from 'fs';
import path from 'path';

describe('Browser Compatibility', () => {
  it('should not have static imports of Node.js-only packages in connection.js', () => {
    // Check the compiled output to ensure no static imports
    const connectionJsPath = path.join(__dirname, '../../../dist/core/connection.js');

    // Skip test if dist directory doesn't exist (e.g., during initial development)
    if (!fs.existsSync(connectionJsPath)) {
      console.warn('⚠️ Skipping browser compatibility test: dist/core/connection.js not found');
      console.warn('   Run `npm run build` first to generate the compiled output');
      return;
    }

    const content = fs.readFileSync(connectionJsPath, 'utf8');

    // Get the first 10 lines where imports typically are
    const firstLines = content.split('\n').slice(0, 10).join('\n');

    // Check for static imports of Node.js-only packages
    const nodeOnlyPackages = ['@clickhouse/client'];

    for (const pkg of nodeOnlyPackages) {
      // Check for static import statements (not dynamic require)
      const staticImportPattern = new RegExp(`import\\s+.*from\\s+['"]${pkg}['"]`, 'g');
      const matches = firstLines.match(staticImportPattern);

      if (matches) {
        throw new Error(
          `Found static import of Node.js-only package "${pkg}" in connection.js!\n` +
          `This will cause browser bundling issues.\n\n` +
          `Matched imports:\n${matches.join('\n')}\n\n` +
          `Use dynamic require() instead:\n` +
          `  const clientNode = require('${pkg}');\n`
        );
      }
    }

    // Verify that dynamic require() is present for Node.js client
    expect(content).toContain("require('@clickhouse/client')");
  });

  it('should only have type imports of Node.js packages at the top level', () => {
    // Read the source TypeScript file
    const connectionTsPath = path.join(__dirname, '../connection.ts');
    const content = fs.readFileSync(connectionTsPath, 'utf8');

    // Get the import section (first 30 lines should be enough)
    const importSection = content.split('\n').slice(0, 30).join('\n');

    // Check for value imports (non-type imports) of Node.js packages
    const valueImportPattern = /import\s+\{[^}]*\}\s+from\s+['"]@clickhouse\/client['"]/g;

    const valueImports = importSection.match(valueImportPattern) || [];

    // Filter out type-only imports
    const nonTypeValueImports = valueImports.filter(importStatement => {
      return !importStatement.includes('import type');
    });

    if (nonTypeValueImports.length > 0) {
      throw new Error(
        `Found non-type value imports of @clickhouse/client in connection.ts!\n` +
        `This will cause browser bundling issues.\n\n` +
        `Found imports:\n${nonTypeValueImports.join('\n')}\n\n` +
        `Make sure to use "import type" for TypeScript types only:\n` +
        `  import type { ClickHouseClient } from '@clickhouse/client';\n\n` +
        `For runtime values, use dynamic require() inside functions.`
      );
    }
  });
});
