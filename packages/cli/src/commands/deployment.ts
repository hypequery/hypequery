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
} from '../utils/deployment-bundle.js';
import { captureDeploymentSourceSnapshot } from '../utils/deployment-source-snapshot.js';
import { loadCloudPublication } from '../utils/load-cloud-publication.js';
import { logger } from '../utils/logger.js';
import {
  loadCloudCredential,
  type StoredCloudCredential,
} from '../utils/cloud-credential-store.js';

export interface BuildDeploymentOptions {
  bundleOutput?: string;
  source?: boolean;
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

export async function buildDeploymentCommand(
  sourcePath: string | undefined,
  options: BuildDeploymentOptions = {},
): Promise<ProtocolDeploymentContract> {
  if (!sourcePath) {
    throw new Error(
      'Missing Cloud publication module path.\n\n'
      + 'Usage: hypequery deployment:build analytics/cloud.ts',
    );
  }

  const bundleOutput = options.bundleOutput ?? DEFAULT_BUNDLE_OUTPUT;
  const contract = await loadCloudPublication(sourcePath);
  const candidate = contract as unknown as { queries?: unknown[]; artifacts?: unknown[] };
  if ((Array.isArray(candidate.queries) && candidate.queries.length > 0)
    || (Array.isArray(candidate.artifacts) && candidate.artifacts.length > 0)) {
    throw new Error('Cloud publication modules may publish datasets only.');
  }
  const prepared = prepareProtocolDeploymentContract(contract);
  const sourceSnapshot = options.source === false
    ? undefined
    : await captureDeploymentSourceSnapshot(sourcePath);
  const bundle = await writeDeploymentBundle(bundleOutput, prepared, sourceSnapshot);
  logger.success(`Deployment bundle written to ${bundle.directory}`);
  if (bundle.manifest.source) {
    logger.info(
      `Captured ${bundle.manifest.source.files.length} source `
      + `${bundle.manifest.source.files.length === 1 ? 'file' : 'files'}`,
    );
  }
  logger.info(
    `${prepared.contract.datasets.length} `
    + `${prepared.contract.datasets.length === 1 ? 'dataset' : 'datasets'}, 0 runtime artifacts`,
  );
  logger.info(`Bundle identity: ${bundle.identity}`);
  logger.info(`Deployment identity: ${prepared.identity}`);
  return prepared.contract;
}

function describeContract(
  contract: ProtocolDeploymentContract,
): string {
  const datasets = `${contract.datasets.length} `
    + `${contract.datasets.length === 1 ? 'dataset' : 'datasets'}`;
  return datasets;
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

  let prepared: { readonly contract: ProtocolDeploymentContract; readonly identity: string };
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
