import path from 'node:path';
import { decodeProtocolClientContract } from '@hypequery/protocol';
import { GENERATED_CLIENT_HEADER, renderClientContract } from '../generators/client-contract/render.js';
import { checkClientOutputPath, describeClientContractError, readClientArtifact, readClientOutput } from '../utils/client-contract-file.js';
import { clientOrigin, fetchCloudClientContract } from '../utils/cloud-client-contract.js';
import { resolveDeploymentCredential, type CloudDeploymentAccessDependencies } from '../utils/cloud-deployment-access.js';
import { deploymentTargetFromOptions } from '../utils/deployment-target.js';
import { writeGeneratedFileAtomically } from '../utils/generated-file.js';
import { fetchHostedEndpoints } from '../utils/hosted-endpoints.js';
import type { LiveDeploymentFetch } from '../utils/live-deployment.js';
import { logger } from '../utils/logger.js';
import { updateCommandTelemetry, setCommandTelemetryError } from '../utils/telemetry/command-context.js';
import { countBucket } from '../utils/telemetry/buckets.js';
import { CliError } from '../utils/machine-output/cli-error.js';

export interface GenerateClientOptions {
  output?: string;
  check?: boolean;
  force?: boolean;
  /** Read the live Cloud release's contract instead of a file (target and credential from `hypequery login`). */
  cloud?: boolean;
  project?: string;
  environment?: string;
  endpoint?: string;
}

export interface GenerateClientDependencies extends CloudDeploymentAccessDependencies {
  readonly fetch?: LiveDeploymentFetch;
  readonly fetchEndpoints?: typeof fetchHostedEndpoints;
}

/** The live release's contract, and the origin it is served from when Cloud says. */
async function readCloudClientContract(options: GenerateClientOptions, dependencies: GenerateClientDependencies) {
  const access = await resolveDeploymentCredential(options.endpoint, dependencies);
  const target = deploymentTargetFromOptions(options, access.storedCredential);
  const request = { endpoint: access.endpoint, token: access.token, target, fetch: dependencies.fetch };
  const [text, endpoints] = await Promise.all([
    fetchCloudClientContract(request),
    (dependencies.fetchEndpoints ?? fetchHostedEndpoints)(request),
  ]);
  return { text, baseUrl: clientOrigin(endpoints?.rest.baseUrl) };
}

export async function generateClientCommand(
  artifact: string | undefined,
  options: GenerateClientOptions = {},
  dependencies: GenerateClientDependencies = {},
): Promise<GenerateClientResult> {
  updateCommandTelemetry('generate:client', { mode: options.check ? 'check' : 'write', force: !!options.force, custom_output: options.output !== undefined });
  if (options.force && options.check) throw new CliError('USAGE', '--force cannot be combined with --check.');
  if (options.cloud ? artifact !== undefined : artifact === undefined) {
    throw new CliError('USAGE', options.cloud
      ? 'Pass a client contract file or --cloud, not both.'
      : 'Missing client contract. Pass a contract JSON file, or --cloud for the live Cloud release.');
  }
  if (!options.cloud && (options.project ?? options.environment ?? options.endpoint) !== undefined) {
    throw new CliError('USAGE', '--project, --environment and --endpoint apply only with --cloud.');
  }
  const output = path.resolve(options.output ?? 'analytics/hypequery-client.ts');
  if (artifact !== undefined && path.resolve(artifact) === output) throw new CliError('INVALID_INPUT', 'Client input and output must be different files.');
  await checkClientOutputPath(output);
  const current = await readClientOutput(output);
  const { text, baseUrl } = artifact === undefined
    ? await readCloudClientContract(options, dependencies)
    : { text: await readClientArtifact(path.resolve(artifact)), baseUrl: undefined };
  let contract: ReturnType<typeof decodeProtocolClientContract>;
  try {
    contract = decodeProtocolClientContract(text);
  } catch (error) {
    throw describeClientContractError(error);
  }
  if (contract.view !== 'build') throw new CliError('INVALID_INPUT', 'Client generation requires a build view exported by the definition owner.');
  const contents = renderClientContract(contract, { baseUrl });
  if (Buffer.byteLength(contents) > 16 * 1_048_576) throw new Error('Generated client exceeds the 16 MiB output limit.');
  updateCommandTelemetry('generate:client', { endpoint_count_bucket: countBucket(contract.endpoints.length) });
  if (current === contents) {
    updateCommandTelemetry('generate:client', { check_result: 'up_to_date' });
    logger.success('Client types and routes are up to date.');
    return { status: 'up_to_date', output, endpoints: contract.endpoints.length };
  }
  if (options.check) {
    updateCommandTelemetry('generate:client', { check_result: current === undefined ? 'missing' : 'out_of_date' });
    setCommandTelemetryError(current === undefined ? 'output_missing' : 'output_out_of_date');
    logger.error('Client types and routes are missing or out of date.');
    throw new CliError('OUT_OF_DATE', `Client types and routes are ${current === undefined ? 'missing' : 'out of date'}: ${output}`, {
      reported: true,
      telemetry: current === undefined ? 'output_missing' : 'output_out_of_date',
      hint: 'Run the command again with --force (without --check) to regenerate the client.',
      issues: [{ path: output, message: current === undefined ? 'missing' : 'out of date' }],
    });
  }
  if (current !== undefined && !options.force) throw new CliError('CONFLICT', 'Refusing to overwrite client types; use --check or --force.');
  if (current !== undefined && !current.startsWith(GENERATED_CLIENT_HEADER)) {
    throw new CliError('CONFLICT', `Refusing to overwrite ${output}: it was not generated by hypequery generate:client.`);
  }
  await checkClientOutputPath(output);
  if (await readClientOutput(output) !== current) throw new CliError('CONFLICT', 'Client output changed during generation; retry after reviewing it.');
  await writeGeneratedFileAtomically(output, contents, { overwrite: options.force === true });
  logger.success('Generated client types and routes.');
  return { status: current === undefined ? 'created' : 'updated', output, endpoints: contract.endpoints.length };
}

/** `hypequery generate:client --json`. `output` is absolute. */
export interface GenerateClientResult {
  readonly status: 'up_to_date' | 'created' | 'updated';
  readonly output: string;
  readonly endpoints: number;
}
