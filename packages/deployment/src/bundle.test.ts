import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
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

const deployment = {
  kind: 'hypequery-deployment' as const,
  version: 2 as const,
  datasets: [orders],
};

async function writeBundle(
  contract: unknown,
  options: { readonly extraArtifactBytes?: Uint8Array; readonly nonCanonicalDeployment?: boolean } = {},
): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'hypequery-bundle-verify-'));
  temporaryDirectories.push(parent);
  const directory = path.join(parent, 'bundle');
  await mkdir(directory);
  const prepared = prepareProtocolDeploymentContract(contract);
  const deploymentBytes = new TextEncoder().encode(options.nonCanonicalDeployment
    ? `${JSON.stringify(prepared.contract, null, 2)}\n`
    : `${prepared.canonical}\n`);
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
  it('reads a deployment bundle at the canonical version', async () => {
    const directory = await writeBundle(deployment);

    const verified = await verifyDeploymentBundle(directory);

    expect(verified.contract.version).toBe(2);
    expect(verified.contract.datasets.map(entry => entry.name)).toEqual(['orders']);
  });

  it('refuses runtime artifacts in a deployment bundle', async () => {
    const directory = await writeBundle(deployment, {
      extraArtifactBytes: new TextEncoder().encode('export const queries = {};\n'),
    });

    await expect(verifyDeploymentBundle(directory)).rejects.toThrow(
      /deployment bundle cannot contain runtime artifacts/,
    );
  });

  it('refuses non-canonical deployment JSON even when its digest matches the manifest', async () => {
    const directory = await writeBundle(deployment, { nonCanonicalDeployment: true });

    await expect(verifyDeploymentBundle(directory)).rejects.toThrow(
      /Deployment JSON must contain canonical JSON/,
    );
  });
});
