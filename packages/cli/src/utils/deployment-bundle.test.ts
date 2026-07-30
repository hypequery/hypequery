import { createHash } from 'node:crypto';
import {
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
  readDeploymentRuntimeFile,
  verifyDeploymentBundle,
  writeDeploymentBundle,
} from './deployment-bundle.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-bundle-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function deployment(artifactSha256?: string) {
  return {
    kind: 'hypequery-deployment' as const,
    version: 1 as const,
    datasets: [],
    queries: artifactSha256
      ? [{
          name: 'handler',
          input: { kind: 'any' as const },
          output: { kind: 'any' as const },
          implementation: {
            kind: 'runtime-reference' as const,
            runtime: 'node' as const,
            artifactSha256,
            entrypoint: 'queries.handler',
          },
          endpoint: {
            access: { kind: 'public' as const },
            tenant: { kind: 'not-required' as const },
            method: 'POST' as const,
            path: '/handler',
          },
          tags: [],
        }]
      : [],
    artifacts: artifactSha256
      ? [{ runtime: 'node' as const, artifactSha256 }]
      : [],
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
  it('writes and verifies a deterministic Dataset-only bundle', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    const prepared = prepareProtocolDeploymentContract(deployment());

    const written = await writeDeploymentBundle(output, prepared, []);
    const verified = await verifyDeploymentBundle(output);

    expect(written.directory).toBe(output);
    expect(verified.contract).toEqual(prepared.contract);
    expect(verified.identity).toBe(written.identity);
    expect(Object.isFrozen(verified.manifest)).toBe(true);
    expect(JSON.parse(await readFile(path.join(output, DEPLOYMENT_BUNDLE_MANIFEST), 'utf8')))
      .toEqual(written.manifest);
  });

  it('binds runtime bytes to the deployment artifact reference', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    const bytes = new TextEncoder().encode('export const queries = {};\n');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const prepared = prepareProtocolDeploymentContract(deployment(digest));

    const written = await writeDeploymentBundle(output, prepared, [{
      runtime: 'node',
      sha256: digest,
      bytes,
    }]);
    const verified = await verifyDeploymentBundle(output);

    expect(written.manifest.artifacts).toEqual([{
      runtime: 'node',
      path: `artifacts/${digest}.mjs`,
      sha256: digest,
      byteLength: bytes.byteLength,
    }]);
    expect(verified.contract.artifacts[0]?.artifactSha256).toBe(digest);
  });

  it('writes and verifies a multi-file source snapshot', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    const prepared = prepareProtocolDeploymentContract(deployment());
    const apiBytes = new TextEncoder().encode('export { Orders } from "./orders.js";\n');
    const datasetBytes = new TextEncoder().encode('export const Orders = {};\n');

    const written = await writeDeploymentBundle(output, prepared, [], {
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

  it('rejects tampered runtime bytes', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    const bytes = new TextEncoder().encode('original');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const prepared = prepareProtocolDeploymentContract(deployment(digest));
    await writeDeploymentBundle(output, prepared, [{ runtime: 'node', sha256: digest, bytes }]);
    await writeFile(path.join(output, `artifacts/${digest}.mjs`), 'tampered');

    await expect(verifyDeploymentBundle(output)).rejects.toThrow(/SHA-256 does not match/);
  });

  it('rejects undeclared files', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    await writeDeploymentBundle(output, prepareProtocolDeploymentContract(deployment()), []);
    await writeFile(path.join(output, 'extra.txt'), 'undeclared');

    await expect(verifyDeploymentBundle(output)).rejects.toThrow(/undeclared file/);
  });

  it('rejects symbolic links without following them', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    await writeDeploymentBundle(output, prepareProtocolDeploymentContract(deployment()), []);
    await symlink(path.join(output, 'deployment.json'), path.join(output, 'linked.json'));

    await expect(verifyDeploymentBundle(output)).rejects.toThrow(/must not be symbolic links/);
  });

  it('rejects a prebuilt runtime symbolic link', async () => {
    const parent = await temporaryDirectory();
    const runtime = path.join(parent, 'runtime.mjs');
    const linked = path.join(parent, 'linked.mjs');
    await writeFile(runtime, 'runtime');
    await symlink(runtime, linked);

    await expect(readDeploymentRuntimeFile(linked)).rejects.toThrow(/must not be a symbolic link/);
  });

  it('rejects missing runtime bytes before creating output', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    const prepared = prepareProtocolDeploymentContract(deployment('0'.repeat(64)));

    await expect(writeDeploymentBundle(output, prepared, []))
      .rejects.toThrow(/missing node runtime artifact/);
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects deployment artifacts that no named query references', async () => {
    const parent = await temporaryDirectory();
    const bytes = new TextEncoder().encode('unreferenced');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const unreferenced = {
      ...deployment(),
      artifacts: [{ runtime: 'node' as const, artifactSha256: digest }],
    };

    await expect(writeDeploymentBundle(
      path.join(parent, 'bundle'),
      prepareProtocolDeploymentContract(unreferenced),
      [{ runtime: 'node', sha256: digest, bytes }],
    )).rejects.toThrow(/unreferenced runtime artifacts/);
  });

  it('replaces only an existing verified bundle', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    const prepared = prepareProtocolDeploymentContract(deployment());
    await writeDeploymentBundle(output, prepared, []);

    const replaced = await writeDeploymentBundle(output, prepared, []);
    const verified = await verifyDeploymentBundle(output);
    expect(verified.identity).toBe(replaced.identity);
  });

  it('warns without failing when an obsolete backup cannot be removed', async () => {
    const parent = await temporaryDirectory();
    const output = path.join(parent, 'bundle');
    const prepared = prepareProtocolDeploymentContract(deployment());
    await writeDeploymentBundle(output, prepared, []);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    mockRm.mockImplementation(async (target, options) => {
      if (String(target).includes('.bundle.previous-')) {
        throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
      }
      return actual.rm(target, options);
    });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const replaced = await writeDeploymentBundle(output, prepared, []);
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

    await expect(writeDeploymentBundle(
      output,
      prepareProtocolDeploymentContract(deployment()),
      [],
    )).rejects.toThrow(/Refusing to replace/);
    expect(await readFile(output, 'utf8')).toBe('unrelated');
  });
});
