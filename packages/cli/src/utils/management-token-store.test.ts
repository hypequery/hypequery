import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  deleteManagementCredentials,
  loadAllManagementCredentials,
  loadManagementCredential,
  saveManagementCredential,
  type StoredManagementCredential,
} from './management-token-store.js';

const directories: string[] = [];

async function store(options: { vault?: boolean } = {}) {
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'hypequery-management-test-'));
  directories.push(configDirectory);
  const passwords = new Map<string, string>();
  const vaultUp = options.vault !== false;
  return {
    configDirectory,
    passwords,
    file: path.join(configDirectory, 'cloud-management-tokens.json'),
    createKeyringEntry: (_service: string, account: string) => {
      if (!vaultUp) throw new Error('no Secret Service');
      return {
        setPassword: (password: string) => {
          passwords.set(account, password);
        },
        getPassword: () => passwords.get(account) ?? null,
        deletePassword: () => passwords.delete(account),
      };
    },
  };
}

function credential(overrides: Partial<StoredManagementCredential> = {}): StoredManagementCredential {
  return {
    cloudUrl: 'https://cloud.example.test',
    token: `hqmt_v1_${'a'.repeat(43)}`,
    expiresAt: '2030-01-01T00:00:00.000Z',
    deploymentEndpoint: 'https://cloud.example.test/v1/deployments/submissions',
    organizationId: 'org_1',
    project: 'shop',
    projectLimited: true,
    capabilities: ['workspace:view', 'deployment:publish'],
    signedInWith: 'device',
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })));
});

describe('management token store', () => {
  it('keeps the token in the vault and only metadata on disk, owner-only', async () => {
    const dependencies = await store();
    await expect(saveManagementCredential(credential(), dependencies))
      .resolves.toEqual({ storage: 'vault', path: dependencies.file });

    const text = await readFile(dependencies.file, 'utf8');
    expect(text).not.toContain('hqmt_v1_');
    expect((await stat(dependencies.file)).mode & 0o777).toBe(0o600);
    expect((await stat(dependencies.configDirectory)).mode & 0o777).toBe(0o700);
    expect(dependencies.passwords.get('management:https://cloud.example.test')).toBe(credential().token);
    await expect(loadManagementCredential({}, dependencies)).resolves.toEqual(credential());
  });

  it('falls back to an owner-only file when the vault is unavailable', async () => {
    const dependencies = await store({ vault: false });
    await expect(saveManagementCredential(credential(), dependencies))
      .resolves.toMatchObject({ storage: 'file' });

    expect((await stat(dependencies.file)).mode & 0o777).toBe(0o600);
    const onDisk = JSON.parse(await readFile(dependencies.file, 'utf8')) as {
      origins: Record<string, { storage: string; token: string }>;
    };
    expect(onDisk.origins['https://cloud.example.test']).toMatchObject({ storage: 'file', token: credential().token });
    await expect(loadManagementCredential({}, dependencies)).resolves.toEqual(credential());
  });

  it('stores one token per Cloud origin and defaults to the latest sign-in', async () => {
    const dependencies = await store();
    const local = credential({
      cloudUrl: 'http://localhost:3000',
      token: `hqmt_v1_${'b'.repeat(43)}`,
      deploymentEndpoint: 'http://localhost:3000/v1/deployments/submissions',
    });
    await saveManagementCredential(credential(), dependencies);
    await saveManagementCredential(local, dependencies);

    await expect(loadManagementCredential({}, dependencies)).resolves.toEqual(local);
    await expect(loadManagementCredential({ cloudUrl: 'https://cloud.example.test' }, dependencies))
      .resolves.toEqual(credential());
    await expect(loadManagementCredential({ cloudUrl: 'https://other.example.test' }, dependencies))
      .resolves.toBeNull();
    const all = await loadAllManagementCredentials(dependencies);
    expect(all.credentials).toHaveLength(2);
  });

  it('returns null with no store, and refuses a tampered one', async () => {
    const dependencies = await store();
    await expect(loadManagementCredential({}, dependencies)).resolves.toBeNull();
    await saveManagementCredential(credential(), dependencies);
    const onDisk = JSON.parse(await readFile(dependencies.file, 'utf8')) as {
      origins: Record<string, Record<string, unknown>>;
    };
    // An endpoint on another origin would send the token elsewhere.
    onDisk.origins['https://cloud.example.test']!.deploymentEndpoint = 'https://evil.example.test/v1/deployments/submissions';
    await writeFile(dependencies.file, JSON.stringify(onDisk));
    await expect(loadManagementCredential({}, dependencies)).rejects.toThrow(/invalid/);
  });

  it('refuses to store anything but a management token', async () => {
    const dependencies = await store();
    await expect(saveManagementCredential(credential({ token: `hqdp_v1_${'a'.repeat(43)}` }), dependencies))
      .rejects.toThrow(/invalid/);
  });

  it('deletes one origin or everything, including vault entries', async () => {
    const dependencies = await store();
    await saveManagementCredential(credential(), dependencies);
    await saveManagementCredential(credential({
      cloudUrl: 'http://localhost:3000',
      deploymentEndpoint: 'http://localhost:3000/v1/deployments/submissions',
    }), dependencies);

    await deleteManagementCredentials({ cloudUrl: 'http://localhost:3000' }, dependencies);
    expect(dependencies.passwords.has('management:http://localhost:3000')).toBe(false);
    await expect(loadManagementCredential({ cloudUrl: 'https://cloud.example.test' }, dependencies))
      .resolves.toEqual(credential());
    // The removed origin was the default; nothing is chosen in its place.
    await expect(loadManagementCredential({}, dependencies)).resolves.toBeNull();

    await deleteManagementCredentials({}, dependencies);
    expect(dependencies.passwords.size).toBe(0);
    await expect(stat(dependencies.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps every entry when several sign-ins save at once', async () => {
    const dependencies = await store();
    const origins = Array.from({ length: 8 }, (_unused, index) => `https://cloud-${index}.example.test`);
    await Promise.all(origins.map((cloudUrl, index) => saveManagementCredential(credential({
      cloudUrl,
      token: `hqmt_v1_${String(index).repeat(43)}`,
      deploymentEndpoint: `${cloudUrl}/v1/deployments/submissions`,
    }), dependencies)));

    const all = await loadAllManagementCredentials(dependencies);
    expect(all.unreadable).toBe(0);
    expect(all.credentials.map(stored => stored.cloudUrl).sort()).toEqual(origins);
    await expect(stat(`${dependencies.file}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the other origin when a save and a delete run at once', async () => {
    const dependencies = await store();
    const local = credential({
      cloudUrl: 'http://localhost:3000',
      deploymentEndpoint: 'http://localhost:3000/v1/deployments/submissions',
    });
    await saveManagementCredential(credential(), dependencies);
    await Promise.all([
      saveManagementCredential(local, dependencies),
      deleteManagementCredentials({ cloudUrl: 'https://cloud.example.test' }, dependencies),
    ]);
    const all = await loadAllManagementCredentials(dependencies);
    expect(all.credentials).toEqual([local]);
    expect([...dependencies.passwords.keys()]).toEqual(['management:http://localhost:3000']);
  });

  it('clearDefault stops another origin being the default, and keeps its token', async () => {
    const dependencies = await store();
    await saveManagementCredential(credential(), dependencies);

    // A sign-in to another Cloud that stored no management token.
    await deleteManagementCredentials({ cloudUrl: 'https://other.example.test', clearDefault: true }, dependencies);
    await expect(loadManagementCredential({}, dependencies)).resolves.toBeNull();
    await expect(loadManagementCredential({ cloudUrl: 'https://cloud.example.test' }, dependencies))
      .resolves.toEqual(credential());
    expect(dependencies.passwords.size).toBe(1);

    // Without it, deleting an origin that isn't stored changes nothing.
    await saveManagementCredential(credential(), dependencies);
    await deleteManagementCredentials({ cloudUrl: 'https://other.example.test' }, dependencies);
    await expect(loadManagementCredential({}, dependencies)).resolves.toEqual(credential());
  });

  it('does not create the config directory to delete from a store that is not there', async () => {
    const dependencies = await store();
    const configDirectory = path.join(dependencies.configDirectory, 'never-created');
    await deleteManagementCredentials({}, { ...dependencies, configDirectory });
    await expect(stat(configDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes a malformed store so logout always works', async () => {
    const dependencies = await store();
    await saveManagementCredential(credential(), dependencies);
    await writeFile(dependencies.file, JSON.stringify({
      version: 99,
      origins: { 'https://cloud.example.test': { broken: true } },
    }));
    await expect(loadAllManagementCredentials(dependencies)).resolves.toEqual({ credentials: [], unreadable: 1 });
    await deleteManagementCredentials({}, dependencies);
    expect(dependencies.passwords.size).toBe(0);
    await expect(stat(dependencies.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
