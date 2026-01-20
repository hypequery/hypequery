import { access } from 'node:fs/promises';
import path from 'node:path';

/**
 * Generic helper to find a file from a list of candidate paths
 */
async function findFile(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const resolved = path.resolve(process.cwd(), candidate);
    try {
      await access(resolved);
      return resolved;
    } catch {
      // Continue checking
    }
  }

  return null;
}

/**
 * Common query file locations to check
 */
const DEFAULT_QUERY_PATHS = [
  'hypequery.ts',
  'analytics/queries.ts',
  'src/analytics/queries.ts',
  'queries.ts',
  'src/queries.ts',
];

/**
 * Find the queries file in the project
 */
export async function findQueriesFile(customPath?: string): Promise<string | null> {
  // If custom path provided, check only that
  if (customPath) {
    const resolved = path.resolve(process.cwd(), customPath);
    try {
      await access(resolved);
      return resolved;
    } catch {
      return null;
    }
  }

  // Check default locations
  return findFile(DEFAULT_QUERY_PATHS);
}

/**
 * Find the schema file (generated types)
 */
export async function findSchemaFile(): Promise<string | null> {
  return findFile([
    'analytics/schema.ts',
    'src/analytics/schema.ts',
    'schema.ts',
    'src/schema.ts',
  ]);
}

/**
 * Find the client file
 */
export async function findClientFile(): Promise<string | null> {
  return findFile([
    'analytics/client.ts',
    'src/analytics/client.ts',
    'client.ts',
    'src/client.ts',
  ]);
}

/**
 * Check if .env file exists
 */
export async function hasEnvFile(): Promise<boolean> {
  try {
    await access(path.join(process.cwd(), '.env'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if .gitignore exists
 */
export async function hasGitignore(): Promise<boolean> {
  try {
    await access(path.join(process.cwd(), '.gitignore'));
    return true;
  } catch {
    return false;
  }
}
