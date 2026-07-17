import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  encodeProtocolDeploymentContractToString,
  hashProtocolDeploymentContract,
  validateProtocolDeploymentContract,
  type ProtocolDeploymentContract,
} from '@hypequery/protocol';
import { loadApiModule } from '../utils/load-api.js';
import { logger } from '../utils/logger.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface BuildDeploymentOptions {
  output?: string;
  runtime?: 'node' | 'python';
  runtimeArtifact?: string;
  entrypointPrefix?: string;
  hashOutput?: string;
}

interface DeploymentContractSource {
  deploymentContract(options?: {
    runtimeArtifact?: {
      runtime: 'node' | 'python';
      artifactSha256: string;
      entrypointPrefix?: string;
    };
  }): ProtocolDeploymentContract;
}

function runtimeArtifact(options: BuildDeploymentOptions) {
  if (options.runtimeArtifact === undefined) return undefined;
  if (!SHA256_PATTERN.test(options.runtimeArtifact)) {
    throw new Error('--runtime-artifact must be a lowercase 64-character SHA-256 digest.');
  }
  const runtime = options.runtime ?? 'node';
  if (runtime !== 'node' && runtime !== 'python') {
    throw new Error('--runtime must be either node or python.');
  }
  return {
    runtime,
    artifactSha256: options.runtimeArtifact,
    ...(options.entrypointPrefix !== undefined
      ? { entrypointPrefix: options.entrypointPrefix }
      : {}),
  };
}

export async function buildDeploymentCommand(
  apiPath: string | undefined,
  options: BuildDeploymentOptions = {},
): Promise<ProtocolDeploymentContract> {
  if (!apiPath) {
    throw new Error(
      'Missing API module path.\n\n'
      + 'Usage: hypequery deployment:build analytics/api.ts',
    );
  }

  const artifact = runtimeArtifact(options);
  const api = await loadApiModule(apiPath) as DeploymentContractSource;
  if (typeof api.deploymentContract !== 'function') {
    throw new Error(
      `Invalid API module: ${apiPath}\n\n`
      + 'The exported API must provide deploymentContract(). '
      + 'Upgrade @hypequery/serve and export the value returned by createAPI() or serve().',
    );
  }

  const contract = api.deploymentContract(artifact ? { runtimeArtifact: artifact } : {});
  const validated = validateProtocolDeploymentContract(contract);
  const canonical = encodeProtocolDeploymentContractToString(validated);
  const digest = hashProtocolDeploymentContract(validated);
  const outputPath = options.output ?? 'analytics/hypequery-deployment.json';
  const hashOutputPath = options.hashOutput ?? `${outputPath}.sha256`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(hashOutputPath), { recursive: true });
  await writeFile(outputPath, `${canonical}\n`, 'utf8');
  await writeFile(hashOutputPath, `${digest}  ${path.basename(outputPath)}\n`, 'utf8');

  logger.success(`Deployment contract written to ${outputPath}`);
  logger.info(`Identity: ${digest}`);
  return validated;
}

export async function validateDeploymentCommand(
  artifactPath: string | undefined,
): Promise<ProtocolDeploymentContract> {
  if (!artifactPath) {
    throw new Error(
      'Missing deployment artifact path.\n\n'
      + 'Usage: hypequery deployment:validate analytics/hypequery-deployment.json',
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(await readFile(artifactPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid deployment JSON: ${artifactPath}\n\n`
      + (error instanceof Error ? error.message : String(error)),
    );
  }

  const contract = validateProtocolDeploymentContract(input);
  const digest = hashProtocolDeploymentContract(contract);
  logger.success(`Valid deployment contract: ${artifactPath}`);
  logger.info(
    `${contract.datasets.length} datasets, ${contract.queries.length} queries, `
    + `${contract.artifacts.length} runtime artifacts`,
  );
  logger.info(`Identity: ${digest}`);
  return contract;
}
