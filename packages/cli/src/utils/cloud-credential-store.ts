import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const KEYCHAIN_SERVICE = 'dev.hypequery.cli';
const PROFILE_FILE = 'cloud-profile.json';

export interface StoredCloudCredential {
  readonly cloudUrl: string;
  readonly deploymentEndpoint: string;
  readonly expiresAt: string;
  readonly scope: string;
  readonly token: string;
}

interface StoredCloudProfile {
  readonly version: 1;
  readonly cloudUrl: string;
  readonly deploymentEndpoint: string;
  readonly expiresAt: string;
  readonly scope: string;
  readonly keychainAccount: string;
}

interface KeyringEntry {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): unknown;
}

export interface CloudCredentialStoreDependencies {
  readonly configDirectory?: string;
  readonly createKeyringEntry?: (
    service: string,
    account: string,
  ) => Promise<KeyringEntry> | KeyringEntry;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
}

function defaultConfigDirectory(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
) {
  if (env.HYPEQUERY_CONFIG_DIR) return env.HYPEQUERY_CONFIG_DIR;
  if (platform === 'win32') {
    return path.join(env.APPDATA ?? env.LOCALAPPDATA ?? homedir(), 'hypequery');
  }
  if (platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'hypequery');
  }
  return path.join(env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'hypequery');
}

async function defaultKeyringEntry(service: string, account: string) {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry(service, account);
  } catch (error) {
    throw new Error(
      'The operating-system credential vault is unavailable. '
      + 'Install its keyring service or use HYPEQUERY_API_TOKEN for manual authentication.',
      { cause: error },
    );
  }
}

function paths(dependencies: CloudCredentialStoreDependencies) {
  const env = dependencies.env ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const directory = dependencies.configDirectory
    ?? defaultConfigDirectory(env, platform);
  return { directory, profile: path.join(directory, PROFILE_FILE) };
}

function parseProfile(input: string): StoredCloudProfile {
  const value = JSON.parse(input) as Partial<StoredCloudProfile>;
  if (
    value.version !== 1
    || typeof value.cloudUrl !== 'string'
    || typeof value.deploymentEndpoint !== 'string'
    || typeof value.expiresAt !== 'string'
    || typeof value.scope !== 'string'
    || typeof value.keychainAccount !== 'string'
  ) {
    throw new Error('The stored Hypequery Cloud profile is invalid. Run `hypequery login` again.');
  }
  return value as StoredCloudProfile;
}

async function entry(
  account: string,
  dependencies: CloudCredentialStoreDependencies,
) {
  const create = dependencies.createKeyringEntry ?? defaultKeyringEntry;
  return create(KEYCHAIN_SERVICE, account);
}

export async function saveCloudCredential(
  credential: StoredCloudCredential,
  dependencies: CloudCredentialStoreDependencies = {},
) {
  const location = paths(dependencies);
  const keychainAccount = new URL(credential.cloudUrl).origin;
  const keyring = await entry(keychainAccount, dependencies);
  await Promise.resolve(keyring.setPassword(credential.token));

  const profile: StoredCloudProfile = {
    version: 1,
    cloudUrl: credential.cloudUrl,
    deploymentEndpoint: credential.deploymentEndpoint,
    expiresAt: credential.expiresAt,
    scope: credential.scope,
    keychainAccount,
  };
  await mkdir(location.directory, { recursive: true, mode: 0o700 });
  await chmod(location.directory, 0o700);
  const temporary = `${location.profile}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporary, location.profile);
    await chmod(location.profile, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    await Promise.resolve(keyring.deletePassword()).catch(() => undefined);
    throw error;
  }
}

export async function loadCloudCredential(
  dependencies: CloudCredentialStoreDependencies = {},
): Promise<StoredCloudCredential | null> {
  const location = paths(dependencies);
  let profile: StoredCloudProfile;
  try {
    profile = parseProfile(await readFile(location.profile, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const keyring = await entry(profile.keychainAccount, dependencies);
  const token = await Promise.resolve(keyring.getPassword());
  if (!token) {
    throw new Error('The Hypequery Cloud token is missing from your credential vault. Run `hypequery login` again.');
  }
  return {
    cloudUrl: profile.cloudUrl,
    deploymentEndpoint: profile.deploymentEndpoint,
    expiresAt: profile.expiresAt,
    scope: profile.scope,
    token,
  };
}

export async function deleteCloudCredential(
  dependencies: CloudCredentialStoreDependencies = {},
) {
  const location = paths(dependencies);
  let profile: StoredCloudProfile | null = null;
  try {
    profile = parseProfile(await readFile(location.profile, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (profile) {
    const keyring = await entry(profile.keychainAccount, dependencies);
    await Promise.resolve(keyring.deletePassword()).catch(() => undefined);
  }
  await unlink(location.profile).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
}
