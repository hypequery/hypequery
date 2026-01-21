import { pathToFileURL } from 'node:url';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { ensureTypeScriptRuntime } from './ensure-ts-runtime.js';

const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

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

  // Load the embedded tsx runtime on demand for any TypeScript entrypoint
  const extension = path.extname(resolved).toLowerCase();
  const isTypeScript = TYPESCRIPT_EXTENSIONS.has(extension);
  if (isTypeScript) {
    try {
      await ensureTypeScriptRuntime();
    } catch (error: any) {
      throw new Error(
        `Failed to load TypeScript support. This should never happen because the CLI bundles tsx.\n` +
        `Original error: ${error?.message ?? error}`
      );
    }
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
