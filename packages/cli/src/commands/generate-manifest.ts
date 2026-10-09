import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadApiModule } from '../utils/load-api.js';
import { logger } from '../utils/logger.js';
import { updateCommandTelemetry } from '../utils/telemetry/command-context.js';
import { manifestMetrics } from '../utils/telemetry/generation-metrics.js';

export interface GenerateManifestOptions {
  output?: string;
}

export async function generateManifestCommand(
  apiPath: string | undefined,
  options: GenerateManifestOptions = {},
) {
  updateCommandTelemetry('generate:manifest', { custom_output: options.output !== undefined });
  if (!apiPath) {
    throw new Error(
      'Missing API module path.\n\n' +
      'Usage: hypequery generate:manifest analytics/api.ts --output analytics/hypequery-manifest.json',
    );
  }

  const outputPath = options.output ?? 'analytics/hypequery-manifest.json';
  const api = await loadApiModule(apiPath);

  if (!api || typeof api.manifest !== 'function') {
    throw new Error(
      `Invalid API module: ${apiPath}\n\n` +
      `The exported API must provide a manifest() method. ` +
      `Export the value returned by createAPI() or initServe(...).serve(...).`,
    );
  }

  const manifest = api.manifest();
  updateCommandTelemetry('generate:manifest', manifestMetrics(api, manifest));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  logger.success(`Manifest written to ${outputPath}`);
}
