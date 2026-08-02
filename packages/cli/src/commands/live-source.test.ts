import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { success: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { diffCommand, pullCommand } from './live-source.js';

const directories: string[] = [];
const target = { project: 'acme:analytics', environment: 'production' };
const releaseIdentity = 'a'.repeat(64);

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function credential(scope = 'deploy:submit deploy:read-source') {
  return {
    cloudUrl: 'https://cloud.example.test',
    deploymentEndpoint: 'https://cloud.example.test/v1/deployments/submissions',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    scope,
    target,
    token: 'secret-token',
  };
}

function live(files: readonly { path: string; bytes: Uint8Array }[]) {
  return {
    target,
    active: {
      revision: 'b'.repeat(64),
      releaseIdentity,
      activatedAt: '2026-08-01T10:00:00.000Z',
      restored: false,
      hasSource: true,
      source: {
        entrypoint: 'analytics/api.ts',
        files: files.map(file => ({
          path: file.path,
          sha256: sha256(file.bytes),
          bytes: file.bytes,
        })),
      },
    },
  } as const;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('live source commands', () => {
  it('pulls the exact multi-file snapshot into a new directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hypequery-pull-test-'));
    directories.push(root);
    const destination = path.join(root, 'snapshot');
    const api = new TextEncoder().encode('import { orders } from "./orders.js";\n');
    const orders = new TextEncoder().encode('export const orders = {};\n');

    await pullCommand({ output: destination }, {
      env: {},
      loadCredential: async () => credential(),
      fetchLive: async () => live([
        { path: 'analytics/api.ts', bytes: api },
        { path: 'analytics/orders.ts', bytes: orders },
      ]),
    });

    await expect(readFile(path.join(destination, 'analytics/api.ts'), 'utf8'))
      .resolves.toBe(new TextDecoder().decode(api));
    await expect(readFile(path.join(destination, 'analytics/orders.ts'), 'utf8'))
      .resolves.toBe(new TextDecoder().decode(orders));
  });

  it('never overwrites an existing pull destination', async () => {
    const destination = await mkdtemp(path.join(tmpdir(), 'hypequery-pull-existing-'));
    directories.push(destination);

    await expect(pullCommand({ output: destination }, {
      env: {},
      loadCredential: async () => credential(),
      fetchLive: async () => live([{
        path: 'analytics/api.ts',
        bytes: new TextEncoder().encode('export {};\n'),
      }]),
    })).rejects.toThrow('Refusing to overwrite');
  });

  it('reports added, modified, and deleted source files', async () => {
    const same = new TextEncoder().encode('same\n');
    const differences = await diffCommand('analytics/api.ts', {}, {
      env: {},
      loadCredential: async () => credential(),
      fetchLive: async () => live([
        { path: 'analytics/api.ts', bytes: same },
        { path: 'analytics/changed.ts', bytes: new TextEncoder().encode('old\n') },
        { path: 'analytics/deleted.ts', bytes: new TextEncoder().encode('gone\n') },
      ]),
      captureSource: async () => ({
        entrypoint: 'analytics/api.ts',
        files: [
          { path: 'analytics/api.ts', bytes: same },
          { path: 'analytics/changed.ts', bytes: new TextEncoder().encode('new\n') },
          { path: 'analytics/added.ts', bytes: new TextEncoder().encode('added\n') },
        ],
      }),
    });

    expect(differences).toEqual([
      { status: 'A', path: 'analytics/added.ts' },
      { status: 'M', path: 'analytics/changed.ts' },
      { status: 'D', path: 'analytics/deleted.ts' },
    ]);
  });

  it('asks legacy interactive credentials to login again', async () => {
    const fetchLive = vi.fn();

    await expect(diffCommand(undefined, {}, {
      env: {},
      loadCredential: async () => credential('deploy:submit'),
      fetchLive,
    })).rejects.toThrow('hypequery login');

    expect(fetchLive).not.toHaveBeenCalled();
  });
});
