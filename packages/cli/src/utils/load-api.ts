import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

export async function loadApiModule(modulePath: string) {
  const resolved = path.resolve(process.cwd(), modulePath);

  // Check if file exists first
  try {
    await access(resolved);
  } catch {
    const relativePath = path.relative(process.cwd(), resolved);
    throw new Error(
      `File not found: ${relativePath}\n\n` +
      `Make sure the file exists and the path is correct.\n` +
      `You can specify a different file with:\n` +
      `  hypequery dev path/to/your/queries.ts`
    );
  }

  // If it's a TypeScript file and tsx isn't already loaded, re-exec with tsx
  const isTypeScript = resolved.endsWith('.ts') || resolved.endsWith('.mts') || resolved.endsWith('.cts');
  if (isTypeScript && !process.env.TSX_LOADED) {
    // Check if tsx is available
    try {
      // @ts-ignore - tsx module might not have types
      await import('tsx/esm');
    } catch {
      throw new Error(
        `To run TypeScript files directly, install tsx:\n  npm install -D tsx\n\nOr compile your TypeScript first and use the .js file instead.`
      );
    }

    // Re-exec the current command with tsx
    console.error('\n⚠️  TypeScript detected. Restarting with tsx...\n');

    // Use npx tsx to run the CLI binary directly
    // This is more reliable than using --import tsx/esm
    const child = spawn(
      'npx',
      ['tsx', ...process.argv.slice(1)],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          TSX_LOADED: 'true', // Prevent infinite restart loop
        },
      }
    );

    child.on('exit', (code) => {
      process.exit(code || 0);
    });

    child.on('error', (error) => {
      console.error('Failed to restart with tsx:', error);
      process.exit(1);
    });

    // Return a never-resolving promise since we're exiting
    return new Promise(() => {});
  }

  // Load the module (works for both .js and .ts if tsx is loaded)
  const moduleUrl = `${pathToFileURL(resolved).href}?t=${Date.now()}`;
  let mod: any;

  try {
    mod = await import(moduleUrl);
  } catch (error: any) {
    const relativePath = path.relative(process.cwd(), resolved);
    throw new Error(
      `Failed to load module: ${relativePath}\n\n` +
      `Error: ${error.message}\n\n` +
      (error.code === 'ERR_MODULE_NOT_FOUND'
        ? `This usually means:\n` +
          `  • A dependency is missing (run 'npm install')\n` +
          `  • An import path is incorrect\n`
        : ``) +
      (error.stack ? `\nStack trace:\n${error.stack}\n` : '')
    );
  }

  const api = mod.api ?? mod.default;

  if (!api || typeof api.handler !== 'function') {
    const relativePath = path.relative(process.cwd(), resolved);
    const availableExports = Object.keys(mod).filter(key => key !== '__esModule');

    throw new Error(
      `Invalid API module: ${relativePath}\n\n` +
      `The module must export a 'defineServe' result as 'api'.\n\n` +
      (availableExports.length > 0
        ? `Found exports: ${availableExports.join(', ')}\n\n`
        : `No exports found in the module.\n\n`) +
      `Expected format:\n\n` +
      `  import { initServe } from '@hypequery/serve';\n` +
      `  \n` +
      `  const { define, queries, query } = initServe({\n` +
      `    context: () => ({ db }),\n` +
      `  });\n` +
      `  \n` +
      `  export const api = define({\n` +
      `    queries: queries({\n` +
      `      myQuery: query.query(async ({ ctx }) => {\n` +
      `        // ...\n` +
      `      }),\n` +
      `    }),\n` +
      `  });\n`
    );
  }

  return api;
}
