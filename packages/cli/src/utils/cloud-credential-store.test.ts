import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  deleteCloudCredential,
  loadCloudCredential,
  saveCloudCredential,
} from './cloud-credential-store.js';

const directories: string[] = [];

async function store() {
  const configDirectory = await mkdtemp(path.join(tmpdir(), 'hypequery-credential-test-'));
  directories.push(configDirectory);
  const passwords = new Map<string, string>();
  return {
    configDirectory,
    passwords,
    createKeyringEntry: (_service: string, account: string) => ({
      setPassword: (password: string) => {
        passwords.set(account, password);
      },
      getPassword: () => passwords.get(account) ?? null,
      deletePassword: () => passwords.delete(account),
    }),
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(directory => rm(directory, {
      force: true,
      recursive: true,
    })),
  );
});

describe('Cloud credential store', () => {
  it('stores only profile metadata on disk and keeps the token in the keychain', async () => {
    const dependencies = await store();
    const credential = {
      cloudUrl: 'https://cloud.example.test',
      deploymentEndpoint: 'https://cloud.example.test/v1/deployments/submissions',
      expiresAt: '2030-01-01T00:00:00.000Z',
      scope: 'deploy:submit',
      target: {
        project: 'acme:analytics',
        environment: 'production',
      },
      token: `hqdp_v1_${'a'.repeat(43)}`,
    };
    await saveCloudCredential(credential, dependencies);

    const profilePath = path.join(dependencies.configDirectory, 'cloud-profile.json');
    const profile = await readFile(profilePath, 'utf8');
    expect(profile).not.toContain(credential.token);
    expect((await stat(profilePath)).mode & 0o777).toBe(0o600);
    await expect(loadCloudCredential(dependencies)).resolves.toEqual(credential);
  });

  it('rejects profile metadata that redirects a vault token to another origin', async () => {
    const dependencies = await store();
    await saveCloudCredential({
      cloudUrl: 'https://cloud.example.test',
      deploymentEndpoint: 'https://cloud.example.test/v1/deployments/submissions',
      expiresAt: '2030-01-01T00:00:00.000Z',
      scope: 'deploy:submit',
      token: `hqdp_v1_${'a'.repeat(43)}`,
    }, dependencies);
    const profilePath = path.join(dependencies.configDirectory, 'cloud-profile.json');
    const profile = JSON.parse(await readFile(profilePath, 'utf8')) as {
      deploymentEndpoint: string;
    };
    profile.deploymentEndpoint =
      'https://attacker.example.test/v1/deployments/submissions';
    await writeFile(profilePath, `${JSON.stringify(profile)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });

    await expect(loadCloudCredential(dependencies)).rejects.toThrow(
      /stored Hypequery Cloud profile is invalid/,
    );
  });

  it('rejects a profile whose vault account is not bound to its Cloud origin', async () => {
    const dependencies = await store();
    await saveCloudCredential({
      cloudUrl: 'https://cloud.example.test',
      deploymentEndpoint: 'https://cloud.example.test/v1/deployments/submissions',
      expiresAt: '2030-01-01T00:00:00.000Z',
      scope: 'deploy:submit',
      token: `hqdp_v1_${'a'.repeat(43)}`,
    }, dependencies);
    const profilePath = path.join(dependencies.configDirectory, 'cloud-profile.json');
    const profile = JSON.parse(await readFile(profilePath, 'utf8')) as {
      keychainAccount: string;
    };
    profile.keychainAccount = 'https://another-cloud.example.test';
    await writeFile(profilePath, `${JSON.stringify(profile)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });

    await expect(loadCloudCredential(dependencies)).rejects.toThrow(
      /stored Hypequery Cloud profile is invalid/,
    );
  });

  it('deletes both the local profile and keychain token', async () => {
    const dependencies = await store();
    await saveCloudCredential({
      cloudUrl: 'https://cloud.example.test',
      deploymentEndpoint: 'https://cloud.example.test/v1/deployments/submissions',
      expiresAt: '2030-01-01T00:00:00.000Z',
      scope: 'deploy:submit',
      token: `hqdp_v1_${'b'.repeat(43)}`,
    }, dependencies);

    await deleteCloudCredential(dependencies);
    await expect(loadCloudCredential(dependencies)).resolves.toBeNull();
    expect(dependencies.passwords.size).toBe(0);
  });

  it('restores an existing keychain token when the profile cannot be committed', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'hypequery-credential-test-'));
    directories.push(parent);
    const configDirectory = path.join(parent, 'not-a-directory');
    await writeFile(configDirectory, 'blocked', 'utf8');
    const account = 'https://cloud.example.test';
    const passwords = new Map([[account, 'previous-token']]);
    const dependencies = {
      configDirectory,
      createKeyringEntry: (_service: string, keychainAccount: string) => ({
        setPassword: (password: string) => {
          passwords.set(keychainAccount, password);
        },
        getPassword: () => passwords.get(keychainAccount) ?? null,
        deletePassword: () => passwords.delete(keychainAccount),
      }),
    };

    await expect(saveCloudCredential({
      cloudUrl: account,
      deploymentEndpoint: `${account}/v1/deployments/submissions`,
      expiresAt: '2030-01-01T00:00:00.000Z',
      scope: 'deploy:submit',
      token: 'replacement-token',
    }, dependencies)).rejects.toThrow();

    expect(passwords.get(account)).toBe('previous-token');
  });

  it('removes the previous keychain entry when the Cloud origin changes', async () => {
    const dependencies = await store();
    await saveCloudCredential({
      cloudUrl: 'https://first-cloud.example.test',
      deploymentEndpoint:
        'https://first-cloud.example.test/v1/deployments/submissions',
      expiresAt: '2030-01-01T00:00:00.000Z',
      scope: 'deploy:submit',
      token: 'first-token',
    }, dependencies);

    const replacement = {
      cloudUrl: 'https://second-cloud.example.test',
      deploymentEndpoint:
        'https://second-cloud.example.test/v1/deployments/submissions',
      expiresAt: '2030-01-01T00:00:00.000Z',
      scope: 'deploy:submit',
      token: 'second-token',
    };
    await saveCloudCredential(replacement, dependencies);

    expect(dependencies.passwords).toEqual(new Map([
      ['https://second-cloud.example.test', 'second-token'],
    ]));
    await expect(loadCloudCredential(dependencies)).resolves.toEqual(replacement);
  });
});
