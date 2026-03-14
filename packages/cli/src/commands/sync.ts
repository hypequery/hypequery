import fs from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { findQueriesFile } from '../utils/find-files.js';
import { loadApiModule } from '../utils/load-api.js';
import { displayQueriesFileNotFoundError } from '../utils/error-messages.js';

export interface SyncOptions {
  output?: string;
  format?: 'json' | 'yaml';
  quiet?: boolean;
}

/**
 * Registry entry extracted from an endpoint.
 */
interface RegistryEntry {
  key: string;
  name?: string;
  path: string;
  method: string;
  description?: string;
  tags: string[];
  hasInput: boolean;
  inputFields?: string[];
  hasTenant: boolean;
  isCached: boolean;
  cacheTtlMs?: number;
  requiresAuth: boolean;
  requiredRoles?: string[];
  requiredScopes?: string[];
  visibility?: string;
  custom?: Record<string, unknown>;
}

/**
 * Extract input field names from a Zod schema.
 */
function extractInputFields(schema: unknown): string[] | undefined {
  if (!schema) return undefined;

  const schemaAny = schema as {
    shape?: Record<string, unknown>;
    _def?: { shape?: () => Record<string, unknown> };
  };

  if (schemaAny.shape && typeof schemaAny.shape === 'object') {
    return Object.keys(schemaAny.shape);
  }

  if (schemaAny._def?.shape && typeof schemaAny._def.shape === 'function') {
    try {
      return Object.keys(schemaAny._def.shape());
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Extract registry entries from an API module.
 */
function extractRegistry(api: Record<string, unknown>): RegistryEntry[] {
  const queries = api.queries as Record<string, Record<string, unknown>> | undefined;

  if (!queries) {
    return [];
  }

  return Object.entries(queries).map(([key, endpoint]) => {
    const metadata = endpoint.metadata as Record<string, unknown> | undefined;
    const cacheTtl = (endpoint.cacheTtlMs ?? metadata?.cacheTtlMs) as number | null | undefined;

    return {
      key,
      name: (metadata?.name as string) || key,
      path: (endpoint.path as string) || (metadata?.path as string) || `/${key}`,
      method: (endpoint.method as string) || (metadata?.method as string) || 'GET',
      description: (metadata?.description as string) || (endpoint.description as string),
      tags: (metadata?.tags as string[]) || (endpoint.tags as string[]) || [],
      hasInput: endpoint.inputSchema !== undefined,
      inputFields: extractInputFields(endpoint.inputSchema),
      hasTenant: endpoint.tenant !== undefined,
      isCached: cacheTtl !== undefined && cacheTtl !== null && cacheTtl > 0,
      cacheTtlMs: typeof cacheTtl === 'number' ? cacheTtl : undefined,
      requiresAuth: (metadata?.requiresAuth as boolean) || false,
      requiredRoles: metadata?.requiredRoles as string[] | undefined,
      requiredScopes: metadata?.requiredScopes as string[] | undefined,
      visibility: metadata?.visibility as string | undefined,
      custom: metadata?.custom as Record<string, unknown> | undefined,
    };
  });
}

export async function syncCommand(file?: string, options: SyncOptions = {}) {
  // Step 1: Find queries file
  const queriesFile = await findQueriesFile(file);

  if (!queriesFile) {
    displayQueriesFileNotFoundError('sync');
    process.exit(1);
  }

  if (!options.quiet) {
    logger.info(`Found: ${path.relative(process.cwd(), queriesFile)}`);
    logger.newline();
  }

  // Step 2: Load the API module
  const spinner = ora('Loading API module...').start();

  try {
    const api = await loadApiModule(queriesFile);
    spinner.succeed('Loaded API module');

    // Step 3: Extract registry
    const entries = extractRegistry(api as Record<string, unknown>);

    if (!options.quiet) {
      logger.success(`Found ${entries.length} endpoint${entries.length !== 1 ? 's' : ''}`);
      logger.newline();
    }

    // Step 4: Output registry
    const registry = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      basePath: (api as Record<string, unknown>).basePath || '/api/analytics',
      entries,
    };

    const output = JSON.stringify(registry, null, 2);

    if (options.output) {
      // Write to file
      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, output, 'utf-8');

      if (!options.quiet) {
        logger.success(`Registry written to ${path.relative(process.cwd(), outputPath)}`);
      }
    } else {
      // Output to stdout
      console.log(output);
    }

    if (!options.quiet) {
      logger.newline();
      logger.info('Registry summary:');
      logger.indent(`Total endpoints: ${entries.length}`);
      logger.indent(`With auth: ${entries.filter((e) => e.requiresAuth).length}`);
      logger.indent(`With caching: ${entries.filter((e) => e.isCached).length}`);
      logger.indent(`Tenant-scoped: ${entries.filter((e) => e.hasTenant).length}`);
    }
  } catch (error) {
    spinner.fail('Failed to load API module');
    logger.newline();

    if (error instanceof Error) {
      logger.error(error.message);
      if (error.stack) {
        logger.newline();
        logger.info('Stack trace:');
        logger.info(error.stack);
      }
    } else {
      logger.error(String(error));
    }

    process.exit(1);
  }
}
