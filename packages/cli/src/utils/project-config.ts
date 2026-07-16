import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PROJECT_CONFIG_FILENAME = 'hypequery.config.json';

export interface HypequeryProjectConfig {
  database?: 'chdb';
  chdbPath?: string;
}

function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export async function readProjectConfig(
  cwd: string = process.cwd(),
): Promise<HypequeryProjectConfig> {
  const configPath = path.join(cwd, PROJECT_CONFIG_FILENAME);
  let contents: string;

  try {
    contents = await readFile(configPath, 'utf8');
  } catch (error) {
    if (isFileNotFound(error)) {
      return {};
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`${PROJECT_CONFIG_FILENAME} contains invalid JSON.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${PROJECT_CONFIG_FILENAME} must contain a JSON object.`);
  }

  const config = parsed as Record<string, unknown>;
  if (config.database !== undefined && config.database !== 'chdb') {
    throw new Error(`${PROJECT_CONFIG_FILENAME} has an unsupported database value.`);
  }
  if (config.chdbPath !== undefined && typeof config.chdbPath !== 'string') {
    throw new Error(`${PROJECT_CONFIG_FILENAME} has an invalid chdbPath value.`);
  }

  return {
    ...(config.database === 'chdb' ? { database: 'chdb' as const } : {}),
    ...(typeof config.chdbPath === 'string' && config.chdbPath.length > 0
      ? { chdbPath: config.chdbPath }
      : {}),
  };
}

export async function writeProjectConfig(
  config: HypequeryProjectConfig,
  cwd: string = process.cwd(),
): Promise<void> {
  const configPath = path.join(cwd, PROJECT_CONFIG_FILENAME);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}
