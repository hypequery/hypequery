import { pathToFileURL } from 'node:url';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const tsconfigCache = new Map<string, string | null>();

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

  const extension = path.extname(resolved).toLowerCase();
  const isTypeScript = TYPESCRIPT_EXTENSIONS.has(extension);

  // Load module content. TypeScript entries are bundled with esbuild so we can import them as ESM.
  const moduleUrl = isTypeScript
    ? await bundleTypeScriptModule(resolved)
    : `${pathToFileURL(resolved).href}?t=${Date.now()}`;
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

async function bundleTypeScriptModule(entryPath: string) {
  const relativePath = path.relative(process.cwd(), entryPath);
  const tsconfigPath = await findNearestTsconfig(entryPath);

  try {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: ['node18'],
      sourcemap: 'inline',
      write: false,
      logLevel: 'silent',
      absWorkingDir: process.cwd(),
      packages: 'external',
      tsconfig: tsconfigPath ?? undefined,
      loader: {
        '.ts': 'ts',
        '.tsx': 'tsx',
        '.mts': 'ts',
        '.cts': 'ts',
      },
    });

    const output = result.outputFiles?.find(file => file.path.endsWith('.js')) ?? result.outputFiles?.[0];

    if (!output) {
      throw new Error('esbuild produced no output');
    }

    const contents = `${output.text}\n//# sourceURL=${pathToFileURL(entryPath).href}`;
    const base64 = Buffer.from(contents, 'utf8').toString('base64');
    return `data:text/javascript;base64,${base64}#ts=${Date.now()}`;
  } catch (error: any) {
    throw new Error(
      `Failed to compile ${relativePath} with esbuild.\n` +
      `Original error: ${error?.message ?? error}`
    );
  }
}

async function findNearestTsconfig(filePath: string) {
  let dir = path.dirname(filePath);
  const visited: string[] = [];

  while (true) {
    if (tsconfigCache.has(dir)) {
      const cached = tsconfigCache.get(dir) ?? null;
      visited.forEach(pathname => tsconfigCache.set(pathname, cached));
      return cached;
    }

    visited.push(dir);
    const candidate = path.join(dir, 'tsconfig.json');

    try {
      await access(candidate);
      tsconfigCache.set(dir, candidate);
      visited.forEach(pathname => tsconfigCache.set(pathname, candidate));
      return candidate;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) {
        visited.forEach(pathname => tsconfigCache.set(pathname, null));
        return null;
      }
      dir = parent;
    }
  }
}
