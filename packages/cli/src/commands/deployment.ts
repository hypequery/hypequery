import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  prepareProtocolDeploymentReleaseEnvelope,
  prepareProtocolDeploymentContract,
  type ProtocolDeploymentContract,
  type ProtocolDeploymentReleaseEnvelope,
} from '@hypequery/protocol';
import {
  writeDeploymentBundle,
  verifyDeploymentBundle,
  readDeploymentRuntimeFile,
  type DeploymentBundleRuntimeFile,
} from '../utils/deployment-bundle.js';
import {
  buildNodeRuntimeArtifact,
  getDeploymentRuntimeEntrypoints,
  type NodeRuntimeArtifact,
} from '../utils/deployment-runtime-artifact.js';
import { loadApiModule } from '../utils/load-api.js';
import { logger } from '../utils/logger.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface BuildDeploymentOptions {
  bundleOutput?: string;
  output?: string;
  runtime?: 'node' | 'python';
  runtimeArtifact?: string;
  runtimeFile?: string;
  runtimeOutput?: string;
  entrypointPrefix?: string;
  hashOutput?: string;
}

export interface PrepareDeploymentReleaseOptions {
  project?: string;
  environment?: string;
  output?: string;
}

const DEFAULT_BUNDLE_OUTPUT = 'analytics/hypequery-deployment';

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
  const legacyOutputRequested = options.output !== undefined
    || options.hashOutput !== undefined
    || options.runtimeOutput !== undefined;
  if (options.bundleOutput !== undefined && legacyOutputRequested) {
    throw new Error(
      '--bundle-output cannot be combined with --output, --hash-output, or --runtime-output.',
    );
  }
  const bundleOutput = options.bundleOutput
    ?? (legacyOutputRequested ? undefined : DEFAULT_BUNDLE_OUTPUT);
  if (options.runtimeFile !== undefined && configuredArtifact === undefined) {
    throw new Error('--runtime-file requires --runtime-artifact.');
  }
  if (options.runtimeFile !== undefined && bundleOutput === undefined) {
    throw new Error('--runtime-file is only supported when building a deployment bundle.');
  }
  if (configuredArtifact && bundleOutput !== undefined && options.runtimeFile === undefined) {
    throw new Error(
      'A complete deployment bundle requires --runtime-file with a prebuilt --runtime-artifact.',
    );
  }
  if (configuredArtifact && options.runtimeOutput !== undefined) {
    throw new Error('--runtime-output cannot be used with a prebuilt --runtime-artifact.');
  }
  const outputPath = options.output ?? 'analytics/hypequery-deployment.json';
  const hashOutputPath = options.hashOutput ?? `${outputPath}.sha256`;
  if (options.runtimeOutput !== undefined) {
    assertDistinctOutputPaths({
      '--output': outputPath,
      '--hash-output': hashOutputPath,
      '--runtime-output': options.runtimeOutput,
    });
  }
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
  if (bundleOutput !== undefined) {
    const runtimeFiles: DeploymentBundleRuntimeFile[] = [];
    if (builtArtifact) {
      runtimeFiles.push({
        runtime: 'node',
        sha256: builtArtifact.artifactSha256,
        bytes: builtArtifact.bytes,
      });
    } else if (configuredArtifact && options.runtimeFile) {
      const bytes = await readDeploymentRuntimeFile(options.runtimeFile);
      const actualSha256 = createHash('sha256').update(bytes).digest('hex');
      if (actualSha256 !== configuredArtifact.artifactSha256) {
        throw new Error(
          `Prebuilt runtime artifact SHA-256 mismatch: ${options.runtimeFile}\n\n`
          + `Expected: ${configuredArtifact.artifactSha256}\nActual: ${actualSha256}`,
        );
      }
      runtimeFiles.push({ runtime, sha256: actualSha256, bytes });
    }
    const bundle = await writeDeploymentBundle(bundleOutput, prepared, runtimeFiles);
    logger.success(`Deployment bundle written to ${bundle.directory}`);
    logger.info(`Bundle identity: ${bundle.identity}`);
    logger.info(`Deployment identity: ${digest}`);
    return validated;
  }
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
      + 'Usage: hypequery deployment:validate analytics/hypequery-deployment',
    );
  }

  let artifactStat: Awaited<ReturnType<typeof stat>> | undefined;
  try {
    artifactStat = await stat(artifactPath);
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error
      && (error as { code?: unknown }).code === 'ENOENT')) {
      throw new Error(
        `Cannot inspect deployment input: ${artifactPath}\n\n`
        + (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  if (artifactStat?.isDirectory()) {
    try {
      const bundle = await verifyDeploymentBundle(artifactPath);
      const contract = bundle.contract;
      logger.success(`Valid deployment bundle: ${artifactPath}`);
      logger.info(
        `${contract.datasets.length} datasets, ${contract.queries.length} queries, `
        + `${contract.artifacts.length} runtime artifacts`,
      );
      logger.info(`Bundle identity: ${bundle.identity}`);
      logger.info(`Deployment identity: ${bundle.manifest.deployment.identity}`);
      return contract;
    } catch (error) {
      throw new Error(
        `Invalid deployment bundle: ${artifactPath}\n\n`
        + (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  if (artifactStat && !artifactStat.isFile()) {
    throw new Error(
      `Deployment input must be a regular JSON file or bundle directory: ${artifactPath}`,
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

function assertOutputOutsideBundle(bundlePath: string, outputPath: string): void {
  const bundle = path.resolve(bundlePath);
  const output = path.resolve(outputPath);
  const relative = path.relative(bundle, output);
  const outside = relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
  if (relative === '' || !outside) {
    throw new Error('--output must be outside the closed deployment bundle directory.');
  }
}

async function prospectiveRealPath(inputPath: string): Promise<string> {
  let current = path.resolve(inputPath);
  const missingSegments: string[] = [];
  for (;;) {
    try {
      return path.join(await realpath(current), ...missingSegments);
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error
        && (error as { code?: unknown }).code === 'ENOENT')) {
        throw error;
      }
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) {
          throw new Error('--output must not traverse a dangling symbolic link.');
        }
      } catch (lstatError) {
        if (!(typeof lstatError === 'object' && lstatError !== null && 'code' in lstatError
          && (lstatError as { code?: unknown }).code === 'ENOENT')) {
          throw lstatError;
        }
      }
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
  }
}

export async function prepareDeploymentReleaseCommand(
  bundlePath: string | undefined,
  options: PrepareDeploymentReleaseOptions = {},
): Promise<ProtocolDeploymentReleaseEnvelope> {
  if (!bundlePath) {
    throw new Error(
      'Missing deployment bundle path.\n\n'
      + 'Usage: hypequery deployment:release analytics/hypequery-deployment '
      + '--project <project> --environment <environment>',
    );
  }
  if (options.project === undefined) {
    throw new Error('Missing required --project <project>.');
  }
  if (options.environment === undefined) {
    throw new Error('Missing required --environment <environment>.');
  }
  const outputPath = options.output ?? `${bundlePath.replace(/[\\/]+$/, '')}.release.json`;
  assertOutputOutsideBundle(bundlePath, outputPath);

  let bundle: Awaited<ReturnType<typeof verifyDeploymentBundle>>;
  try {
    bundle = await verifyDeploymentBundle(bundlePath);
  } catch (error) {
    throw new Error(
      `Cannot prepare a release from an invalid deployment bundle: ${bundlePath}\n\n`
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  assertOutputOutsideBundle(
    await realpath(bundlePath),
    await prospectiveRealPath(outputPath),
  );
  const prepared = prepareProtocolDeploymentReleaseEnvelope({
    kind: 'hypequery-deployment-release',
    version: 1,
    bundleIdentity: bundle.identity,
    target: {
      project: options.project,
      environment: options.environment,
    },
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${prepared.canonical}\n`, 'utf8');
  logger.success(`Deployment release written to ${outputPath}`);
  logger.info(`Release identity: ${prepared.identity}`);
  logger.info(`Bundle identity: ${bundle.identity}`);
  return prepared.release;
}
