import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareProtocolDeploymentContract, type ProtocolDeploymentContract } from '@hypequery/protocol';
import { CliError } from '../cli-error.js';
import { verifyDeploymentBundle } from '../deployment-bundle.js';
import { loadModule } from '../load-api.js';

/** Where `onboard check` looks when no source is given, in order. */
export const DEFAULT_CHECK_SOURCES = ['analytics/cloud.ts', 'analytics/datasets.ts', 'analytics/hypequery-deployment'] as const;

export interface LoadedContract {
  readonly source: string;
  readonly kind: 'publication' | 'datasets' | 'bundle' | 'contract';
  readonly contract: ProtocolDeploymentContract;
}

const isDataset = (value: unknown): value is { __type: 'dataset'; name: string } =>
  typeof value === 'object' && value !== null && (value as { __type?: unknown }).__type === 'dataset';

const isContract = (value: unknown): value is ProtocolDeploymentContract =>
  typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'hypequery-deployment';

function invalid(source: string, detail: string): CliError {
  return new CliError('INVALID_INPUT', `Can't read datasets from ${source}: ${detail}`, {
    hint: 'Pass a datasets module (TypeScript), a Cloud publication (`export const cloud = publishToCloud(...)`), '
      + 'a deployment bundle directory or a deployment JSON file.',
  });
}

/**
 * Builds the contract the engine checks from a module that exports datasets,
 * with the project's own `@hypequery/datasets`. Access only shapes endpoints,
 * which the checks don't read, so none is required here.
 */
async function contractFromDatasets(file: string, datasets: Record<string, unknown>): Promise<ProtocolDeploymentContract> {
  let entry: string;
  try {
    entry = createRequire(file).resolve('@hypequery/datasets');
  } catch {
    throw invalid(path.relative(process.cwd(), file), '@hypequery/datasets is not installed in this project.');
  }
  const { publishToCloud } = await import(/* @vite-ignore */ pathToFileURL(entry).href) as {
    publishToCloud: (options: { datasets: Record<string, unknown>; access: { roles: string[]; scopes: string[] } }) => ProtocolDeploymentContract;
  };
  return publishToCloud({ datasets, access: { roles: [], scopes: [] } });
}

/**
 * The dataset contract `onboard check` verifies, from what the project has:
 * a Cloud publication module (`cloud` export), a module exporting datasets,
 * a deployment bundle directory (Python's `write_dataset_bundle`), or a
 * deployment JSON file.
 */
export async function loadOnboardContract(source: string | undefined, cwd = process.cwd()): Promise<LoadedContract> {
  const chosen = source ?? DEFAULT_CHECK_SOURCES.find(candidate => existsSync(path.join(cwd, candidate)));
  if (!chosen) {
    throw new CliError('NOT_FOUND', `No datasets found: pass the datasets file, e.g. \`hypequery onboard check analytics/datasets.ts\` (looked for ${DEFAULT_CHECK_SOURCES.join(', ')}).`, {
      hint: 'Pass the datasets file, Cloud publication, bundle directory or deployment JSON to check.',
    });
  }
  const file = path.resolve(cwd, chosen);
  const info = await stat(file).catch(() => undefined);
  if (!info) throw new CliError('NOT_FOUND', `File not found: ${chosen}`, { hint: 'Check the path to the datasets file.' });

  if (info.isDirectory()) {
    try {
      return { source: file, kind: 'bundle', contract: (await verifyDeploymentBundle(file)).contract };
    } catch (error) {
      throw invalid(chosen, error instanceof Error ? error.message : String(error));
    }
  }
  if (path.extname(file).toLowerCase() === '.json') {
    try {
      return { source: file, kind: 'contract', contract: prepareProtocolDeploymentContract(JSON.parse(await readFile(file, 'utf8'))).contract };
    } catch (error) {
      throw invalid(chosen, error instanceof Error ? error.message : String(error));
    }
  }

  const module = await loadModule(file) as Record<string, unknown>;
  const publication = [module.cloud, module.default].find(isContract);
  if (publication) return { source: file, kind: 'publication', contract: publication };
  const datasets = Object.fromEntries(Object.entries(module).filter(([, value]) => isDataset(value)));
  if (Object.keys(datasets).length === 0) {
    throw invalid(chosen, 'it exports no datasets and no `cloud` publication.');
  }
  try {
    return { source: file, kind: 'datasets', contract: await contractFromDatasets(file, datasets) };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw invalid(chosen, error instanceof Error ? error.message : String(error));
  }
}
