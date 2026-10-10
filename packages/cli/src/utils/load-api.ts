import { pathToFileURL } from 'node:url';
import { rmdirSync, rmSync } from 'node:fs';
import { access, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { findProjectRoot } from './project-root.js';

if (typeof process.setMaxListeners === 'function') {
  process.setMaxListeners(0);
}

const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const tsconfigCache = new Map<string, string | null>();

export async function loadApiModule(modulePath: string) {
  const resolved = path.resolve(process.cwd(), modulePath);
  let mod: any;

  try {
    mod = await loadModule(modulePath);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('File not found:')) {
      const relativePath = path.relative(process.cwd(), resolved);
      throw new Error(
        `File not found: ${relativePath}\n\n` +
        `Make sure the file exists and the path is correct.\n` +
        `You can specify a different file with:\n` +
        `  hypequery dev path/to/your/queries.ts`
      );
    }

    throw error;
  }

  const api = mod.api ?? mod.default;

  if (!api || typeof api.handler !== 'function') {
    const relativePath = path.relative(process.cwd(), resolved);
    const availableExports = Object.keys(mod).filter(key => key !== '__esModule');

    throw new Error(
      `Invalid API module: ${relativePath}\n\n` +
      `The module must export a hypequery API as 'api'.\n\n` +
      (availableExports.length > 0
        ? `Found exports: ${availableExports.join(', ')}\n\n`
        : `No exports found in the module.\n\n`) +
      `Expected format:\n\n` +
      `  import { initServe } from '@hypequery/serve';\n` +
      `  \n` +
      `  const { query, serve } = initServe({\n` +
      `    context: () => ({ db }),\n` +
      `  });\n` +
      `  \n` +
      `  const myQuery = query({\n` +
      `    query: async ({ ctx }) => ctx.db.table('events').select('*').limit(10).execute(),\n` +
      `  });\n` +
      `  \n` +
      `  export const api = serve({\n` +
      `    queries: { myQuery },\n` +
      `  });\n\n` +
      `Or the datasets semantic API:\n\n` +
      `  import { createAPI } from '@hypequery/serve';\n` +
      `  import { db } from './client.js';\n` +
      `  import { datasets } from './datasets.js';\n` +
      `  \n` +
      `  export const api = createAPI({\n` +
      `    queryBuilder: db,\n` +
      `    datasets,\n` +
      `  });\n`
    );
  }

  return api;
}

export async function loadModule(modulePath: string) {
  const resolved = path.resolve(process.cwd(), modulePath);

  try {
    await access(resolved);
  } catch {
    const relativePath = path.relative(process.cwd(), resolved);
    throw new Error(`File not found: ${relativePath}`);
  }

  const extension = path.extname(resolved).toLowerCase();
  const isTypeScript = TYPESCRIPT_EXTENSIONS.has(extension);
  const moduleUrl = isTypeScript
    ? await bundleTypeScriptModule(resolved)
    : `${pathToFileURL(resolved).href}?t=${Date.now()}`;

  try {
    const importOverride = globalState.__hypequeryCliImportOverride;
    return importOverride
      ? await importOverride(moduleUrl)
      : await import(/* @vite-ignore */ moduleUrl);
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
}

const globalState = globalThis as typeof globalThis & {
  __hypequeryCliTempDirPromises?: Map<string, Promise<string>>;
  __hypequeryCliTempFiles?: Set<string>;
  __hypequeryCliTempDirs?: Set<string>;
  __hypequeryCliTempRoots?: Set<string>;
  __hypequeryCliCleanupInstalled?: boolean;
  __hypequeryCliImportOverride?: ((moduleUrl: string) => Promise<any>) | null;
};

// One bundle directory per project root, keyed by that root.
const tempDirPromises = globalState.__hypequeryCliTempDirPromises ??= new Map<string, Promise<string>>();
const tempFiles = globalState.__hypequeryCliTempFiles ??= new Set<string>();
const tempDirs = globalState.__hypequeryCliTempDirs ??= new Set<string>();
const tempRoots = globalState.__hypequeryCliTempRoots ??= new Set<string>();
let cleanupHooksInstalled = globalState.__hypequeryCliCleanupInstalled ?? false;

/**
 * The bundle has to live inside the entry's project: its bare imports
 * (`@hypequery/serve`, ...) resolve from the bundle's location, and the
 * process's working directory may be anywhere (MCP clients launch from `/`).
 */
function ensureTempDir(projectRoot: string) {
  installCleanupHooks();
  let promise = tempDirPromises.get(projectRoot);
  if (!promise) {
    promise = (async () => {
      const projectTempRoot = path.join(projectRoot, '.hypequery', 'tmp');
      try {
        await mkdir(projectTempRoot, { recursive: true });
        tempRoots.add(projectTempRoot);
        const dir = await mkdtemp(path.join(projectTempRoot, 'bundle-'));
        tempDirs.add(dir);
        return dir;
      } catch {
        const fallbackDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-cli-'));
        tempDirs.add(fallbackDir);
        return fallbackDir;
      }
    })();
    tempDirPromises.set(projectRoot, promise);
  }
  return promise;
}

// Synchronous so it completes inside an 'exit' handler.
function cleanupTempArtifacts() {
  for (const target of [...tempFiles, ...tempDirs]) {
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
  tempFiles.clear();
  tempDirs.clear();
  tempDirPromises.clear();

  // Only remove the shared tmp root once empty: another hypequery process in the
  // same project (e.g. `hypequery dev` beside an MCP client) may still use it.
  for (const root of tempRoots) {
    try {
      rmdirSync(root);
    } catch {
      // not empty or already gone
    }
  }
  tempRoots.clear();
}

/** Remove this process's bundles; the CLI awaits this before it exits. */
export async function cleanupLoadedApiArtifacts() {
  cleanupTempArtifacts();
}

function installCleanupHooks() {
  if (cleanupHooksInstalled) return;
  cleanupHooksInstalled = true;
  globalState.__hypequeryCliCleanupInstalled = true;

  // Synchronous, so it still completes when this is the last thing to run.
  process.once('exit', cleanupTempArtifacts);

  // Signal shutdown belongs to the CLI/owning server. Exiting from a module
  // cleanup listener bypassed server teardown and the bounded telemetry flush.
}

async function bundleTypeScriptModule(entryPath: string) {
  const relativePath = path.relative(process.cwd(), entryPath);
  const tsconfigPath = await findNearestTsconfig(entryPath);
  const projectRoot = await findProjectRoot(entryPath);

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
      absWorkingDir: projectRoot,
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

    const tempDir = await ensureTempDir(projectRoot);
    const timestamp = Date.now();
    const tempFile = path.join(
      tempDir,
      `${path.basename(entryPath, path.extname(entryPath))}-${timestamp}.mjs`,
    );
    const contents =
      `${output.text}\n` +
      `//# sourceURL=${pathToFileURL(entryPath).href}\n` +
      `//# hypequery-ts-bundle=${timestamp}`;

    await writeFile(tempFile, contents, 'utf8');
    tempFiles.add(tempFile);

    return `${pathToFileURL(tempFile).href}?t=${timestamp}`;
  } catch (error: any) {
    throw new Error(
      `Failed to compile ${relativePath} with esbuild.\n` +
      `Original error: ${error?.message ?? error}`
    );
  }
}

export async function findNearestTsconfig(filePath: string) {
  let dir = path.dirname(filePath);
  const visited: string[] = [];

  while (dir) {
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

  return null;
}
