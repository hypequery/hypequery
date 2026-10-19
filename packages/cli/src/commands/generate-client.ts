import path from 'node:path';
import { decodeProtocolClientContract } from '@hypequery/protocol';
import { renderClientContract } from '../generators/client-contract/render.js';
import { checkClientOutputPath, readClientArtifact, readClientOutput } from '../utils/client-contract-file.js';
import { writeGeneratedFileAtomically } from '../utils/generated-file.js';
import { logger } from '../utils/logger.js';
import { updateCommandTelemetry, setCommandTelemetryError } from '../utils/telemetry/command-context.js';
import { countBucket } from '../utils/telemetry/buckets.js';

export interface GenerateClientOptions { output?: string; check?: boolean; force?: boolean }

export async function generateClientCommand(artifact: string, options: GenerateClientOptions = {}): Promise<void> {
  updateCommandTelemetry('generate:client', { mode: options.check ? 'check' : 'write', force: !!options.force, custom_output: options.output !== undefined });
  if (options.force && options.check) throw new Error('--force cannot be combined with --check.');
  const input = path.resolve(artifact);
  const output = path.resolve(options.output ?? 'analytics/hypequery-client.ts');
  if (input === output) throw new Error('Client input and output must be different files.');
  await checkClientOutputPath(output);
  const current = await readClientOutput(output);
  const contract = decodeProtocolClientContract(await readClientArtifact(input));
  if (contract.view !== 'build') throw new Error('Client generation requires a build view exported by the definition owner.');
  const contents = renderClientContract(contract);
  if (Buffer.byteLength(contents) > 16 * 1_048_576) throw new Error('Generated client exceeds the 16 MiB output limit.');
  updateCommandTelemetry('generate:client', { endpoint_count_bucket: countBucket(contract.endpoints.length) });
  if (current === contents) {
    updateCommandTelemetry('generate:client', { check_result: 'up_to_date' });
    logger.success('Client types and routes are up to date.');
    return;
  }
  if (options.check) {
    updateCommandTelemetry('generate:client', { check_result: current === undefined ? 'missing' : 'out_of_date' });
    setCommandTelemetryError(current === undefined ? 'output_missing' : 'output_out_of_date');
    process.exitCode = 1;
    logger.error('Client types and routes are missing or out of date.');
    return;
  }
  if (current !== undefined && !options.force) throw new Error('Refusing to overwrite client types; use --check or --force.');
  await checkClientOutputPath(output);
  if (await readClientOutput(output) !== current) throw new Error('Client output changed during generation; retry after reviewing it.');
  await writeGeneratedFileAtomically(output, contents, { overwrite: options.force === true });
  logger.success('Generated client types and routes.');
}
