import { access } from 'node:fs/promises';
import path from 'node:path';

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
  for (const defaultPath of DEFAULT_QUERY_PATHS) {
    const resolved = path.resolve(process.cwd(), defaultPath);
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
 * Find the schema file (generated types)
 */
export async function findSchemaFile(): Promise<string | null> {
  const schemaPaths = [
    'analytics/schema.ts',
    'src/analytics/schema.ts',
    'schema.ts',
    'src/schema.ts',
  ];

  for (const schemaPath of schemaPaths) {
    const resolved = path.resolve(process.cwd(), schemaPath);
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
 * Find the client file
 */
export async function findClientFile(): Promise<string | null> {
  const clientPaths = [
    'analytics/client.ts',
    'src/analytics/client.ts',
    'client.ts',
    'src/client.ts',
  ];

  for (const clientPath of clientPaths) {
    const resolved = path.resolve(process.cwd(), clientPath);
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
