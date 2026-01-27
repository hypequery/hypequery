import { pathToFileURL } from 'node:url';
import { access, mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

if (typeof process.setMaxListeners === 'function') {
  process.setMaxListeners(0);
}

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

const globalState = globalThis as typeof globalThis & {
  __hypequeryCliTempDirPromise?: Promise<string> | null;
  __hypequeryCliTempFiles?: Set<string>;
  __hypequeryCliTempDirs?: Set<string>;
  __hypequeryCliCleanupInstalled?: boolean;
};

let tempDirPromise: Promise<string> | null = globalState.__hypequeryCliTempDirPromise ?? null;
const tempFiles = globalState.__hypequeryCliTempFiles ?? new Set<string>();
const tempDirs = globalState.__hypequeryCliTempDirs ?? new Set<string>();
let cleanupHooksInstalled = globalState.__hypequeryCliCleanupInstalled ?? false;

if (!globalState.__hypequeryCliTempFiles) {
  globalState.__hypequeryCliTempFiles = tempFiles;
}
if (!globalState.__hypequeryCliTempDirs) {
  globalState.__hypequeryCliTempDirs = tempDirs;
}

function ensureTempDir() {
  installCleanupHooks();
  if (!tempDirPromise) {
    tempDirPromise = (async () => {
      const projectTempRoot = path.join(process.cwd(), '.hypequery', 'tmp');
      try {
        await mkdir(projectTempRoot, { recursive: true });
        const dir = await mkdtemp(path.join(projectTempRoot, 'bundle-'));
        tempDirs.add(dir);
        return dir;
      } catch {
        const fallbackDir = await mkdtemp(path.join(os.tmpdir(), 'hypequery-cli-'));
        tempDirs.add(fallbackDir);
        return fallbackDir;
      }
    })();
    globalState.__hypequeryCliTempDirPromise = tempDirPromise;
  }
  return tempDirPromise;
}

async function cleanupTempFiles() {
  if (tempFiles.size === 0) return;
  await Promise.all(
    Array.from(tempFiles).map(async file => {
      try {
        await rm(file, { force: true });
      } catch {
        // ignore cleanup failures
      }
    }),
  );
  tempFiles.clear();
}

async function cleanupTempDirs() {
  if (tempDirs.size === 0) return;
  await Promise.all(
    Array.from(tempDirs).map(async dir => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    }),
  );
  tempDirs.clear();

  const projectTempRoot = path.join(process.cwd(), '.hypequery', 'tmp');
  try {
    await rm(projectTempRoot, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}

async function cleanupTempArtifacts() {
  await cleanupTempFiles();
  await cleanupTempDirs();
}

function installCleanupHooks() {
  if (cleanupHooksInstalled) return;
  cleanupHooksInstalled = true;
  globalState.__hypequeryCliCleanupInstalled = true;

  process.once('exit', () => {
    cleanupTempArtifacts().catch(() => undefined);
  });

  (['SIGINT', 'SIGTERM'] as const).forEach(signal => {
    process.once(signal, () => {
      cleanupTempArtifacts().catch(() => undefined);
      process.exit();
    });
  });
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
    const tempDir = await ensureTempDir();
    const tempFile = path.join(
      tempDir,
      `${path.basename(entryPath).replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
    );
    await writeFile(tempFile, contents, 'utf8');
    tempFiles.add(tempFile);
    return `${pathToFileURL(tempFile).href}?t=${Date.now()}`;
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
