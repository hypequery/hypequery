import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  prepareProtocolDatasetOnlyContract,
  prepareProtocolDeploymentBundleManifest,
  prepareProtocolDeploymentContract,
} from '@hypequery/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEPLOYMENT_BUNDLE_CONTRACT,
  DEPLOYMENT_BUNDLE_MANIFEST,
  verifyDeploymentBundle,
} from './bundle.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const orders = {
  name: 'orders',
  source: 'orders',
  tenant: { kind: 'not-required' as const },
  dimensions: [{
    name: 'id',
    type: 'string' as const,
    source: { kind: 'column' as const, column: 'id' },
    filterable: true,
    groupable: true,
  }],
  measures: [],
  filters: [],
  relationships: [],
};

const datasetOnly = {
  kind: 'hypequery-deployment' as const,
  version: 2 as const,
  datasets: [orders],
};

/** A stored release from before the dataset-only wire. */
const legacy = {
  kind: 'hypequery-deployment' as const,
  version: 1 as const,
  datasets: [{
    ...orders,
    metrics: [{
      name: 'orderCount',
      kind: 'metric' as const,
      expression: { kind: 'aggregate' as const, aggregation: 'count' as const, field: 'id' },
      dimensions: [],
      filters: [],
      grains: [],
      endpoint: {
        access: { kind: 'public' as const },
        tenant: { kind: 'not-required' as const },
      },
    }],
  }],
  queries: [],
  artifacts: [],
};

async function writeBundle(
  contract: unknown,
  options: { readonly datasetOnly: boolean; readonly extraArtifactBytes?: Uint8Array },
): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'hypequery-bundle-verify-'));
  temporaryDirectories.push(parent);
  const directory = path.join(parent, 'bundle');
  await mkdir(directory);
  const prepared = options.datasetOnly
    ? prepareProtocolDatasetOnlyContract(contract)
    : prepareProtocolDeploymentContract(contract);
  const deploymentBytes = new TextEncoder().encode(`${prepared.canonical}\n`);
  await writeFile(path.join(directory, DEPLOYMENT_BUNDLE_CONTRACT), deploymentBytes);
  const artifacts: { runtime: 'node'; path: string; sha256: string; byteLength: number }[] = [];
  if (options.extraArtifactBytes) {
    const digest = sha256(options.extraArtifactBytes);
    const artifactPath = `artifacts/${digest}.mjs`;
    await mkdir(path.join(directory, 'artifacts'));
    await writeFile(path.join(directory, artifactPath), options.extraArtifactBytes);
    artifacts.push({
      runtime: 'node',
      path: artifactPath,
      sha256: digest,
      byteLength: options.extraArtifactBytes.byteLength,
    });
  }
  const manifest = prepareProtocolDeploymentBundleManifest({
    kind: 'hypequery-deployment-bundle',
    version: 1,
    deployment: {
      path: DEPLOYMENT_BUNDLE_CONTRACT,
      identity: prepared.identity,
      sha256: sha256(deploymentBytes),
      byteLength: deploymentBytes.byteLength,
    },
    artifacts,
  });
  await writeFile(path.join(directory, DEPLOYMENT_BUNDLE_MANIFEST), `${manifest.canonical}\n`);
  return directory;
}

describe('deployment bundle verification', () => {
  it('reads a dataset-only bundle at the version it was written at', async () => {
    const directory = await writeBundle(datasetOnly, { datasetOnly: true });

    const verified = await verifyDeploymentBundle(directory);

    expect(verified.contract.version).toBe(2);
    expect(verified.datasets).toBe(verified.contract);
    expect(verified.datasets.datasets.map(entry => entry.name)).toEqual(['orders']);
  });

  it('projects a stored v1 release to datasets before downstream use', async () => {
    const directory = await writeBundle(legacy, { datasetOnly: false });

    const verified = await verifyDeploymentBundle(directory);

    // The stored contract is unchanged, so its identity still reproduces.
    expect(verified.contract.version).toBe(1);
    expect((verified.contract as typeof legacy).datasets[0]?.metrics).toHaveLength(1);
    // What downstream reads carries no metric, and no field to carry one.
    expect(verified.datasets.version).toBe(2);
    expect(verified.datasets.datasets[0]?.metrics).toBeUndefined();
    expect(verified.datasets.queries).toBeUndefined();
    expect(verified.datasets.artifacts).toBeUndefined();
  });

  it('refuses runtime artifacts in a dataset-only bundle', async () => {
    const directory = await writeBundle(datasetOnly, {
      datasetOnly: true,
      extraArtifactBytes: new TextEncoder().encode('export const queries = {};\n'),
    });

    await expect(verifyDeploymentBundle(directory)).rejects.toThrow(
      /dataset-only deployment bundle cannot contain runtime artifacts/,
    );
  });
});
