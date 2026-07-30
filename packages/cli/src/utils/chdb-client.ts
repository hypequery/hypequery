import { createRequire } from 'node:module';
import path from 'node:path';
import type { TypeGenerationClickHouseClient } from '../typegen/index.js';

/**
 * Minimal surface of the `chdb` package the CLI relies on. `chdb` is not a
 * dependency of the CLI — it is imported dynamically only when the user asks
 * for the embedded driver (`--database chdb`), so a plain ClickHouse setup
 * never pays for the native engine.
 */
interface ChdbModule {
  Session: new (path?: string) => ChdbSession;
}

interface ChdbSession {
  queryAsync(sql: string, options?: { format?: string }): Promise<{ text(): string }>;
  close(): void;
}

let session: ChdbSession | null = null;
let sessionPath: string | undefined;

export class ChdbNotInstalledError extends Error {
  readonly code = 'CHDB_NOT_INSTALLED';

  constructor() {
    super(
      'The embedded driver needs the `chdb` package. Install it with `npm install chdb` (or your package manager\'s equivalent) and re-run.',
    );
    this.name = 'ChdbNotInstalledError';
  }
}

function isModuleNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND' ||
      (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND')
  );
}

function resolveChdb(requireFn: NodeJS.Require): string | undefined {
  try {
    return requireFn.resolve('chdb');
  } catch (error) {
    if (isModuleNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

async function loadChdb(): Promise<ChdbModule> {
  // Resolve chdb from the USER'S project, not from where the CLI happens to
  // be installed — under `npx` the CLI runs out of the npx cache, where a
  // bare import('chdb') would never see the project's node_modules.
  const requireFromProject = createRequire(path.join(process.cwd(), 'package.json'));
  const projectChdb = resolveChdb(requireFromProject);
  if (projectChdb) {
    // Resolving first lets us distinguish an absent package from failures
    // while loading an installed package (for example, a native ABI error).
    return requireFromProject(projectChdb) as ChdbModule;
  }

  // Retain the fallback for installations where chdb is visible beside the
  // CLI rather than from the project package.json.
  const requireFromCli = createRequire(import.meta.url);
  const cliChdb = resolveChdb(requireFromCli);
  if (cliChdb) {
    return requireFromCli(cliChdb) as ChdbModule;
  }

  throw new ChdbNotInstalledError();
}

/**
 * Get (or create) the embedded chDB session. `path` selects the on-disk
 * database directory; omit it for an ephemeral in-memory session. The session
 * is cached per path — chDB allows one active data directory per process.
 */
export async function getChdbSession(dbPath?: string): Promise<ChdbSession> {
  if (session && sessionPath === dbPath) {
    return session;
  }
  if (session) {
    session.close();
    session = null;
  }
  const chdb = await loadChdb();
  session = new chdb.Session(dbPath);
  sessionPath = dbPath;
  return session;
}

async function queryJsonRows<T>(sql: string, dbPath?: string): Promise<T[]> {
  const s = await getChdbSession(dbPath);
  const result = await s.queryAsync(sql, { format: 'JSONEachRow' });
  return result
    .text()
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

/**
 * The type generator only needs `query({ query, format }) → { json() }` —
 * the `TypeGenerationClickHouseClient` seam — so the embedded session can
 * stand in for an HTTP client without touching the generator itself.
 */
export function getChdbTypeGenerationClient(dbPath?: string): TypeGenerationClickHouseClient {
  return {
    async query({ query }: { query: string; format: 'JSONEachRow' }) {
      return {
        json: async () => queryJsonRows<Record<string, string>>(query, dbPath),
      };
    },
  };
}

/**
 * Throws the actionable install-hint error when `chdb` is missing. Init calls
 * this before the connection test so "package not installed" surfaces as its
 * own message instead of a generic connection failure.
 */
export async function ensureChdbInstalled(): Promise<void> {
  await loadChdb();
}

export async function validateChdb(dbPath?: string): Promise<boolean> {
  try {
    const rows = await queryJsonRows<{ ok: string | number }>('SELECT 1 AS ok', dbPath);
    return rows.length === 1;
  } catch {
    return false;
  }
}

export async function getChdbTables(dbPath?: string): Promise<string[]> {
  try {
    const rows = await queryJsonRows<{ name: string }>('SHOW TABLES', dbPath);
    return rows.map((row) => row.name);
  } catch {
    return [];
  }
}

export async function closeChdbSessionForTesting() {
  if (session) {
    session.close();
    session = null;
    sessionPath = undefined;
  }
}
