import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  prepareProtocolDeploymentReleaseEnvelope,
  prepareProtocolDatasetOnlyContract,
  prepareProtocolDeploymentContract,
  type ProtocolDatasetOnlyContract,
  type ProtocolDeploymentContract,
  type ProtocolDeploymentReleaseEnvelope,
} from '@hypequery/protocol';
import {
  writeDeploymentBundle,
  verifyDeploymentBundle,
} from '../utils/deployment-bundle.js';
import { captureDeploymentSourceSnapshot } from '../utils/deployment-source-snapshot.js';
import { loadApiModule } from '../utils/load-api.js';
import { logger } from '../utils/logger.js';
import { reportCloudDiagnostic, type CloudCompatibilityDiagnosticLike } from '../utils/cloud-diagnostic.js';
import {
  loadCloudCredential,
  type StoredCloudCredential,
} from '../utils/cloud-credential-store.js';

export interface BuildDeploymentOptions {
  bundleOutput?: string;
  output?: string;
  runtime?: 'node' | 'python';
  runtimeArtifact?: string;
  runtimeFile?: string;
  runtimeOutput?: string;
  entrypointPrefix?: string;
  hashOutput?: string;
  source?: boolean;
  allowUnsupportedConfig?: boolean;
}

export interface PrepareDeploymentReleaseOptions {
  project?: string;
  environment?: string;
  output?: string;
}

export interface PrepareDeploymentReleaseDependencies {
  loadCredential?: () => Promise<StoredCloudCredential | null>;
  /**
   * Flag name to quote in output-path errors. `hypequery deploy` delegates
   * here but spells the same option `--release-output`.
   */
  outputFlagLabel?: string;
}

const DEFAULT_BUNDLE_OUTPUT = 'analytics/hypequery-deployment';

interface DeploymentContractSource {
  datasetOnlyContract(options?: {
    onCloudDiagnostic?: (diagnostic: CloudCompatibilityDiagnosticLike) => void;
    allowUnsupportedConfig?: boolean;
  }): ProtocolDatasetOnlyContract;
}

/**
 * A deployment carries datasets, so there is no artifact for these flags to
 * name. They are still accepted by the parser: an existing script that passes
 * one has to be told what replaced it, not handed an unknown-option error.
 */
function rejectRuntimeOptions(options: BuildDeploymentOptions): void {
  const used = [
    ['--runtime', options.runtime],
    ['--runtime-artifact', options.runtimeArtifact],
    ['--runtime-file', options.runtimeFile],
    ['--runtime-output', options.runtimeOutput],
    ['--entrypoint-prefix', options.entrypointPrefix],
  ].filter(([, value]) => value !== undefined).map(([flag]) => flag);
  if (used.length === 0) return;
  throw new Error(
    `${used.join(', ')} ${used.length === 1 ? 'is' : 'are'} no longer supported.\n\n`
    + 'A deployment carries dataset definitions only. Query handlers are no longer '
    + 'bundled into a runtime artifact and no longer run in Cloud; they keep working '
    + 'locally and under self-hosted Serve.',
  );
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
): Promise<ProtocolDatasetOnlyContract> {
  if (!apiPath) {
    throw new Error(
      'Missing API module path.\n\n'
      + 'Usage: hypequery deployment:build analytics/api.ts',
    );
  }

  rejectRuntimeOptions(options);
  const legacyOutputRequested = options.output !== undefined
    || options.hashOutput !== undefined;
  if (options.bundleOutput !== undefined && legacyOutputRequested) {
    throw new Error(
      '--bundle-output cannot be combined with --output or --hash-output.',
    );
  }
  const bundleOutput = options.bundleOutput
    ?? (legacyOutputRequested ? undefined : DEFAULT_BUNDLE_OUTPUT);
  const outputPath = options.output ?? 'analytics/hypequery-deployment.json';
  const hashOutputPath = options.hashOutput ?? `${outputPath}.sha256`;
  const api = await loadApiModule(apiPath) as DeploymentContractSource;
  if (typeof api.datasetOnlyContract !== 'function') {
    throw new Error(
      `Invalid API module: ${apiPath}\n\n`
      + 'The exported API must provide datasetOnlyContract(). '
      + 'Upgrade @hypequery/serve and export the value returned by createAPI() or serve().',
    );
  }

  const contract = api.datasetOnlyContract({
    ...(options.allowUnsupportedConfig ? { allowUnsupportedConfig: true } : {}),
    onCloudDiagnostic: diagnostic => reportCloudDiagnostic(diagnostic, options.allowUnsupportedConfig === true),
  });
  const prepared = prepareProtocolDatasetOnlyContract(contract);
  const { canonical, contract: validated, identity: digest } = prepared;
  if (bundleOutput !== undefined) {
    const sourceSnapshot = options.source === false
      ? undefined
      : await captureDeploymentSourceSnapshot(apiPath);
    const bundle = await writeDeploymentBundle(bundleOutput, prepared, sourceSnapshot);
    logger.success(`Deployment bundle written to ${bundle.directory}`);
    if (bundle.manifest.source) {
      logger.info(
        `Captured ${bundle.manifest.source.files.length} source `
        + `${bundle.manifest.source.files.length === 1 ? 'file' : 'files'}`,
      );
    }
    logger.info(
      `${validated.datasets.length} `
      + `${validated.datasets.length === 1 ? 'dataset' : 'datasets'}, 0 runtime artifacts`,
    );
    logger.info(`Bundle identity: ${bundle.identity}`);
    logger.info(`Deployment identity: ${digest}`);
    return validated;
  }
  assertDistinctOutputPaths({
    '--output': outputPath,
    '--hash-output': hashOutputPath,
  });
  const identitySidecar = [
    '# Hypequery deployment identity v2; not a file checksum or sha256sum input.',
    '# SHA-256(UTF-8("hypequery:deployment:v2") || 0x00 || RFC 8785 canonical bytes); '
      + 'the output newline is excluded.',
    `${digest}  ${path.basename(outputPath)}`,
    '',
  ].join('\n');

  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(hashOutputPath), { recursive: true });
  await writeFile(outputPath, `${canonical}\n`, 'utf8');
  await writeFile(hashOutputPath, identitySidecar, 'utf8');

  logger.success(`Deployment contract written to ${outputPath}`);
  logger.info(`Identity: ${digest}`);
  return validated;
}

/**
 * Summarizes a contract at the version it was written at.
 *
 * A stored v1 release keeps its counts here rather than being reported through
 * its dataset-only projection: `deployment:validate` answers what is in the
 * file, and a v1 bundle that still carries queries is exactly what an author
 * needs to see before rebuilding it.
 */
function describeContract(
  contract: ProtocolDeploymentContract | ProtocolDatasetOnlyContract,
): string {
  const datasets = `${contract.datasets.length} `
    + `${contract.datasets.length === 1 ? 'dataset' : 'datasets'}`;
  if (contract.version === 2) return `${datasets} (dataset-only contract v2)`;
  return `${datasets}, ${contract.queries.length} queries, `
    + `${contract.artifacts.length} runtime artifacts (legacy contract v1)`;
}

export async function validateDeploymentCommand(
  artifactPath: string | undefined,
): Promise<ProtocolDeploymentContract | ProtocolDatasetOnlyContract> {
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
      logger.info(describeContract(contract));
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

  const datasetOnly = typeof input === 'object' && input !== null
    && (input as { readonly version?: unknown }).version === 2;
  let prepared: {
    readonly contract: ProtocolDeploymentContract | ProtocolDatasetOnlyContract;
    readonly identity: string;
  };
  try {
    prepared = datasetOnly
      ? prepareProtocolDatasetOnlyContract(input)
      : prepareProtocolDeploymentContract(input);
  } catch (error) {
    throw new Error(
      `Invalid deployment contract: ${artifactPath}\n\n`
      + (error instanceof Error ? error.message : String(error)),
    );
  }

  const { contract, identity: digest } = prepared;
  logger.success(`Valid deployment contract: ${artifactPath}`);
  logger.info(describeContract(contract));
  logger.info(`Identity: ${digest}`);
  return contract;
}

function assertOutputOutsideBundle(
  bundlePath: string,
  outputPath: string,
  outputFlag: string,
): void {
  const bundle = path.resolve(bundlePath);
  const output = path.resolve(outputPath);
  const relative = path.relative(bundle, output);
  const outside = relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
  if (relative === '' || !outside) {
    throw new Error(`${outputFlag} must be outside the closed deployment bundle directory.`);
  }
}

async function prospectiveRealPath(inputPath: string, outputFlag: string): Promise<string> {
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
          throw new Error(`${outputFlag} must not traverse a dangling symbolic link.`);
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

async function assertOutputIsNotSymbolicLink(
  outputPath: string,
  outputFlag: string,
): Promise<void> {
  try {
    const outputStat = await lstat(outputPath);
    if (outputStat.isSymbolicLink()) {
      throw new Error(`${outputFlag} must not be a symbolic link.`);
    }
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error
      && (error as { code?: unknown }).code === 'ENOENT')) {
      throw error;
    }
  }
}

export async function prepareDeploymentReleaseCommand(
  bundlePath: string | undefined,
  options: PrepareDeploymentReleaseOptions = {},
  dependencies: PrepareDeploymentReleaseDependencies = {},
): Promise<ProtocolDeploymentReleaseEnvelope> {
  if (!bundlePath) {
    throw new Error(
      'Missing deployment bundle path.\n\n'
      + 'Usage: hypequery deployment:release analytics/hypequery-deployment',
    );
  }
  // Passing either flag opts out of the logged-in target entirely. Completing
  // a half-specified override from the stored profile would silently retarget
  // the release — `--project "$P" --environment "$E"` with an unset variable
  // must fail loudly, not bind to whatever the last login used.
  let project: string | undefined;
  let environment: string | undefined;
  if (options.project !== undefined || options.environment !== undefined) {
    if (!options.project) throw new Error('Missing required --project <project>.');
    if (!options.environment) throw new Error('Missing required --environment <environment>.');
    project = options.project;
    environment = options.environment;
  } else {
    const credential = await (
      dependencies.loadCredential ?? loadCloudCredential
    )();
    project = credential?.target?.project;
    environment = credential?.target?.environment;
    if (!project || !environment) {
      throw new Error(
        'Missing deployment target. Run `hypequery login` or pass both '
        + '--project <project> and --environment <environment>.',
      );
    }
  }
  const outputFlag = dependencies.outputFlagLabel ?? '--output';
  const outputPath = options.output ?? `${bundlePath.replace(/[\\/]+$/, '')}.release.json`;
  assertOutputOutsideBundle(bundlePath, outputPath, outputFlag);

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
    bundle.directory,
    await prospectiveRealPath(outputPath, outputFlag),
    outputFlag,
  );
  const prepared = prepareProtocolDeploymentReleaseEnvelope({
    kind: 'hypequery-deployment-release',
    version: 1,
    bundleIdentity: bundle.identity,
    target: {
      project,
      environment,
    },
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await assertOutputIsNotSymbolicLink(outputPath, outputFlag);
  await writeFile(outputPath, `${prepared.canonical}\n`, 'utf8');
  logger.success(`Deployment release written to ${outputPath}`);
  logger.info(`Target: ${project}/${environment}`);
  logger.info(`Release identity: ${prepared.identity}`);
  logger.info(`Bundle identity: ${bundle.identity}`);
  return prepared.release;
}
