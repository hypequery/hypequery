import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  prepareProtocolDeploymentContract,
  type ProtocolDeploymentContract,
} from '@hypequery/protocol';
import {
  buildNodeRuntimeArtifact,
  getDeploymentRuntimeEntrypoints,
  type NodeRuntimeArtifact,
} from '../utils/deployment-runtime-artifact.js';
import { loadApiModule } from '../utils/load-api.js';
import { logger } from '../utils/logger.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface BuildDeploymentOptions {
  output?: string;
  runtime?: 'node' | 'python';
  runtimeArtifact?: string;
  runtimeOutput?: string;
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

function runtimeName(options: BuildDeploymentOptions): 'node' | 'python' {
  const runtime = options.runtime ?? 'node';
  if (runtime !== 'node' && runtime !== 'python') {
    throw new Error('--runtime must be either node or python.');
  }
  return runtime;
}

function configuredRuntimeArtifact(
  options: BuildDeploymentOptions,
  runtime: 'node' | 'python',
) {
  if (options.runtimeArtifact === undefined) return undefined;
  if (!SHA256_PATTERN.test(options.runtimeArtifact)) {
    throw new Error('--runtime-artifact must be a lowercase 64-character SHA-256 digest.');
  }
  return {
    runtime,
    artifactSha256: options.runtimeArtifact,
    ...(options.entrypointPrefix !== undefined
      ? { entrypointPrefix: options.entrypointPrefix }
      : {}),
  };
}

function assertDistinctOutputPaths(paths: Readonly<Record<string, string | undefined>>): void {
  const seen = new Map<string, string>();
  for (const [label, value] of Object.entries(paths)) {
    if (value === undefined) continue;
    const resolved = path.resolve(value);
    const existing = seen.get(resolved);
    if (existing) {
      throw new Error(`${label} must use a different path from ${existing}.`);
    }
    seen.set(resolved, label);
  }
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

  const runtime = runtimeName(options);
  const configuredArtifact = configuredRuntimeArtifact(options, runtime);
  if (configuredArtifact && options.runtimeOutput !== undefined) {
    throw new Error('--runtime-output cannot be used with a prebuilt --runtime-artifact.');
  }
  const outputPath = options.output ?? 'analytics/hypequery-deployment.json';
  const hashOutputPath = options.hashOutput ?? `${outputPath}.sha256`;
  const api = await loadApiModule(apiPath) as DeploymentContractSource;
  if (typeof api.deploymentContract !== 'function') {
    throw new Error(
      `Invalid API module: ${apiPath}\n\n`
      + 'The exported API must provide deploymentContract(). '
      + 'Upgrade @hypequery/serve and export the value returned by createAPI() or serve().',
    );
  }

  let builtArtifact: NodeRuntimeArtifact | undefined;
  let artifact = configuredArtifact;
  if (!artifact) {
    const runtimeEntrypoints = getDeploymentRuntimeEntrypoints(api);
    if (runtimeEntrypoints.length > 0) {
      if (runtime !== 'node') {
        throw new Error(
          'Automatic runtime artifact builds currently support Node only. '
          + 'Provide --runtime-artifact for Python deployments.',
        );
      }
      builtArtifact = await buildNodeRuntimeArtifact(
        apiPath,
        runtimeEntrypoints,
        options.entrypointPrefix,
      );
      artifact = {
        runtime: 'node',
        artifactSha256: builtArtifact.artifactSha256,
        entrypointPrefix: builtArtifact.entrypointPrefix,
      };
    }
  }

  const contract = api.deploymentContract(artifact ? { runtimeArtifact: artifact } : {});
  const prepared = prepareProtocolDeploymentContract(contract);
  const { canonical, contract: validated, identity: digest } = prepared;
  const runtimeOutputPath = builtArtifact
    ? options.runtimeOutput ?? path.join(path.dirname(outputPath), 'hypequery-runtime.mjs')
    : undefined;
  assertDistinctOutputPaths({
    '--output': outputPath,
    '--hash-output': hashOutputPath,
    '--runtime-output': runtimeOutputPath,
  });
  const identitySidecar = [
    '# Hypequery deployment identity v1; not a file checksum or sha256sum input.',
    '# SHA-256(UTF-8("hypequery:deployment:v1") || 0x00 || RFC 8785 canonical bytes); '
      + 'the output newline is excluded.',
    `${digest}  ${path.basename(outputPath)}`,
    '',
  ].join('\n');

  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(hashOutputPath), { recursive: true });
  if (runtimeOutputPath && builtArtifact) {
    await mkdir(path.dirname(runtimeOutputPath), { recursive: true });
    await writeFile(runtimeOutputPath, builtArtifact.bytes);
  }
  await writeFile(outputPath, `${canonical}\n`, 'utf8');
  await writeFile(hashOutputPath, identitySidecar, 'utf8');

  if (runtimeOutputPath && builtArtifact) {
    logger.success(`Runtime artifact written to ${runtimeOutputPath}`);
    logger.info(`Runtime artifact SHA-256: ${builtArtifact.artifactSha256}`);
  }
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

  let prepared: ReturnType<typeof prepareProtocolDeploymentContract>;
  try {
    prepared = prepareProtocolDeploymentContract(input);
  } catch (error) {
    throw new Error(
      `Invalid deployment contract: ${artifactPath}\n\n`
      + (error instanceof Error ? error.message : String(error)),
    );
  }

  const { contract, identity: digest } = prepared;
  logger.success(`Valid deployment contract: ${artifactPath}`);
  logger.info(
    `${contract.datasets.length} datasets, ${contract.queries.length} queries, `
    + `${contract.artifacts.length} runtime artifacts`,
  );
  logger.info(`Identity: ${digest}`);
  return contract;
}
