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
const DEFAULT_API_PATHS = [
  'hypequery.ts',
  'analytics/api.ts',
  'src/analytics/api.ts',
  'api.ts',
  'src/api.ts',
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
  return findFile(DEFAULT_API_PATHS);
}

export async function findApiFileForPath(directory: string): Promise<string | null> {
  return findFile([
    path.join(directory, 'api.ts'),
    path.join(directory, 'queries.ts'),
  ]);
}

/**
 * Find the schema file (generated types)
 */
export async function findSchemaFile(directory?: string): Promise<string | null> {
  if (directory) {
    return path.resolve(process.cwd(), directory, 'schema.ts');
  }

  return findFile([
    'analytics/schema.ts',
    'src/analytics/schema.ts',
    'schema.ts',
    'src/schema.ts',
  ]);
}

export async function findDatasetsFile(directory?: string): Promise<string | null> {
  if (directory) {
    return path.resolve(process.cwd(), directory, 'datasets.ts');
  }

  return findFile([
    'analytics/datasets.ts',
    'src/analytics/datasets.ts',
    'datasets.ts',
    'src/datasets.ts',
    'src/datasets/generated.ts',
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
