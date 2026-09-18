import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareProtocolDeploymentContract } from '@hypequery/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger.js';

const mockRm = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  mockRm.mockImplementation(actual.rm);
  return { ...actual, rm: mockRm };
});
import {
  DEPLOYMENT_BUNDLE_MANIFEST,
  verifyDeploymentBundle,
  writeDeploymentBundle,
} from './deployment-bundle.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-bundle-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function deployment() {
  return {
    kind: 'hypequery-deployment' as const,
    version: 2 as const,
    datasets: [{
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
    }],
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  mockRm.mockImplementation(actual.rm);
  vi.restoreAllMocks();
});

describe('deployment bundle filesystem', () => {
  it('writes and verifies a deterministic deployment bundle', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    const prepared = prepareProtocolDeploymentContract(deployment());

    const written = await writeDeploymentBundle(output, prepared);
    const verified = await verifyDeploymentBundle(output);

    expect(written.directory).toBe(output);
    expect(verified.contract).toEqual(prepared.contract);
    expect(written.manifest.artifacts).toEqual([]);
    expect(verified.identity).toBe(written.identity);
    expect(Object.isFrozen(verified.manifest)).toBe(true);
    expect(JSON.parse(await readFile(path.join(output, DEPLOYMENT_BUNDLE_MANIFEST), 'utf8')))
      .toEqual(written.manifest);
  });

  it('writes and verifies a multi-file source snapshot', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    const prepared = prepareProtocolDeploymentContract(deployment());
    const apiBytes = new TextEncoder().encode('export { Orders } from "./orders.js";\n');
    const datasetBytes = new TextEncoder().encode('export const Orders = {};\n');

    const written = await writeDeploymentBundle(output, prepared, {
      entrypoint: 'analytics/api.ts',
      files: [
        { path: 'analytics/api.ts', bytes: apiBytes },
        { path: 'analytics/orders.ts', bytes: datasetBytes },
      ],
      revision: {
        kind: 'git',
        commit: 'a'.repeat(40),
        dirty: false,
      },
    });
    const verified = await verifyDeploymentBundle(output);

    expect(written.manifest.source?.entrypoint).toBe('analytics/api.ts');
    expect(written.manifest.source?.revision).toEqual({
      kind: 'git',
      commit: 'a'.repeat(40),
      dirty: false,
    });
    expect(verified.manifest.source?.files.map(file => file.path)).toEqual([
      'analytics/api.ts',
      'analytics/orders.ts',
    ]);
    expect(await readFile(path.join(output, 'source/analytics/orders.ts'), 'utf8'))
      .toBe('export const Orders = {};\n');
  });

  it('rejects undeclared files', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    await writeDeploymentBundle(output, prepareProtocolDeploymentContract(deployment()));
    await writeFile(path.join(output, 'extra.txt'), 'undeclared');

    await expect(verifyDeploymentBundle(output)).rejects.toThrow(/undeclared file/);
  });

  it('rejects symbolic links without following them', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    await writeDeploymentBundle(output, prepareProtocolDeploymentContract(deployment()));
    await symlink(path.join(output, 'deployment.json'), path.join(output, 'linked.json'));

    await expect(verifyDeploymentBundle(output)).rejects.toThrow(/must not be symbolic links/);
  });

  it('writes no field a named query or runtime artifact could travel in', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    const prepared = prepareProtocolDeploymentContract(deployment());

    const written = await writeDeploymentBundle(output, prepared);
    const contractJson = JSON.parse(await readFile(path.join(output, 'deployment.json'), 'utf8'));
    const manifestJson = JSON.parse(
      await readFile(path.join(output, DEPLOYMENT_BUNDLE_MANIFEST), 'utf8'),
    );

    expect(contractJson.version).toBe(2);
    expect(contractJson).not.toHaveProperty('queries');
    expect(contractJson).not.toHaveProperty('artifacts');
    for (const entry of contractJson.datasets) expect(entry).not.toHaveProperty('metrics');
    expect(manifestJson.artifacts).toEqual([]);
    expect(written.manifest.artifacts).toEqual([]);
    // Nothing wrote an artifacts directory either.
    await expect(readFile(path.join(output, 'artifacts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a bundle directory that carries leftover artifact bytes', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    await writeDeploymentBundle(output, prepareProtocolDeploymentContract(deployment()));
    await mkdir(path.join(output, 'artifacts'));
    await writeFile(path.join(output, 'artifacts/runtime.mjs'), 'export const queries = {};\n');

    await expect(verifyDeploymentBundle(output)).rejects.toThrow(/undeclared directory/);
  });

  it('replaces only an existing verified bundle', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    const prepared = prepareProtocolDeploymentContract(deployment());
    await writeDeploymentBundle(output, prepared);

    const replaced = await writeDeploymentBundle(output, prepared);
    const verified = await verifyDeploymentBundle(output);
    expect(verified.identity).toBe(replaced.identity);
  });

  it('warns without failing when an obsolete backup cannot be removed', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    const prepared = prepareProtocolDeploymentContract(deployment());
    await writeDeploymentBundle(output, prepared);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    mockRm.mockImplementation(async (target, options) => {
      if (String(target).includes('.bundle.previous-')) {
        throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
      }
      return actual.rm(target, options);
    });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const replaced = await writeDeploymentBundle(output, prepared);
    const verified = await verifyDeploymentBundle(output);

    expect(verified.identity).toBe(replaced.identity);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(
      /previous backup could not be removed:[\s\S]*\.bundle\.previous-[\s\S]*permission denied/,
    ));
  });

  it('does not replace an unrelated existing path', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    await writeFile(output, 'unrelated');

    await expect(writeDeploymentBundle(output, prepareProtocolDeploymentContract(deployment())))
      .rejects.toThrow(/Refusing to replace/);
    expect(await readFile(output, 'utf8')).toBe('unrelated');
  });
});
