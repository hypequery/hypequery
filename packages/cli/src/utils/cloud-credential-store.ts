import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  validateProtocolDeploymentReleaseTarget,
  type ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';

const KEYCHAIN_SERVICE = 'dev.hypequery.cli';
const PROFILE_FILE = 'cloud-profile.json';
export const CLOUD_DEPLOYMENT_SCOPE = 'deploy:submit';
const MAX_KEYCHAIN_ACCOUNT_LENGTH = 2048;

export interface StoredCloudCredential {
  readonly cloudUrl: string;
  readonly deploymentEndpoint: string;
  readonly expiresAt: string;
  readonly scope: string;
  readonly target?: ProtocolDeploymentReleaseTarget;
  readonly token: string;
}

interface StoredCloudProfile {
  readonly version: 1;
  readonly cloudUrl: string;
  readonly deploymentEndpoint: string;
  readonly expiresAt: string;
  readonly scope: string;
  readonly target?: ProtocolDeploymentReleaseTarget;
  readonly keychainAccount: string;
}

interface KeyringEntry {
  setPassword(password: string): void | Promise<void>;
  getPassword(): string | null | Promise<string | null>;
  deletePassword(): unknown;
}

interface VaultEntry {
  setPassword(password: string): Promise<void>;
  getPassword(): Promise<string | null>;
  deletePassword(): Promise<unknown>;
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

function vaultUnavailable(error: unknown): Error {
  return new Error(
    'The operating-system credential vault is unavailable. '
    + 'Install its keyring service or use HYPEQUERY_API_TOKEN for manual authentication.',
    { cause: error },
  );
}

async function defaultKeyringEntry(service: string, account: string) {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry(service, account);
  } catch (error) {
    throw vaultUnavailable(error);
  }
}

function paths(dependencies: CloudCredentialStoreDependencies) {
  const env = dependencies.env ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const directory = dependencies.configDirectory
    ?? defaultConfigDirectory(env, platform);
  return { directory, profile: path.join(directory, PROFILE_FILE) };
}

export function normalizeCloudOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Cloud URL must be an absolute HTTPS URL.');
  }
  const loopback = url.protocol === 'http:'
    && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if ((url.protocol !== 'https:' && !loopback) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Cloud URL must be an HTTPS origin without a path, query, or credentials.');
  }
  return url.origin;
}

export function normalizeCloudDeploymentEndpoint(
  input: string,
  cloudOrigin: string,
): string {
  let endpoint: URL;
  try {
    endpoint = new URL(input);
  } catch {
    throw new Error('Cloud returned an invalid deployment endpoint.');
  }
  // Origin equality is what binds the token to the Cloud that issued it, and it
  // is the only check that has to hold for a tampered profile to be harmless.
  // Cloud owns its own path layout: pinning an exact submission path here would
  // break every already-published CLI the day that path is versioned or moved.
  if (endpoint.origin !== cloudOrigin
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash) {
    throw new Error('Cloud returned an invalid deployment endpoint.');
  }
  return endpoint.toString();
}

function parseProfile(input: string): StoredCloudProfile {
  const parsed = JSON.parse(input) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The stored Hypequery Cloud profile is invalid. Run `hypequery login` again.');
  }
  const value = parsed as Partial<StoredCloudProfile>;
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
  let cloudUrl: string;
  let deploymentEndpoint: string;
  let target: ProtocolDeploymentReleaseTarget | undefined;
  try {
    cloudUrl = normalizeCloudOrigin(value.cloudUrl);
    deploymentEndpoint = normalizeCloudDeploymentEndpoint(
      value.deploymentEndpoint,
      cloudUrl,
    );
    if (value.keychainAccount !== cloudUrl
      || !Number.isFinite(Date.parse(value.expiresAt))
      || value.scope !== CLOUD_DEPLOYMENT_SCOPE) {
      throw new Error('profile invariant mismatch');
    }
    target = value.target === undefined
      ? undefined
      : validateProtocolDeploymentReleaseTarget(value.target);
  } catch {
    throw new Error('The stored Hypequery Cloud profile is invalid. Run `hypequery login` again.');
  }
  return {
    version: 1,
    cloudUrl,
    deploymentEndpoint,
    expiresAt: value.expiresAt,
    scope: value.scope,
    ...(target ? { target } : {}),
    keychainAccount: value.keychainAccount,
  };
}

async function entry(
  account: string,
  dependencies: CloudCredentialStoreDependencies,
): Promise<VaultEntry> {
  const create = dependencies.createKeyringEntry ?? defaultKeyringEntry;
  const created = await create(KEYCHAIN_SERVICE, account);
  // Constructing an entry is lazy — the vault is only contacted on get/set/
  // delete — so a locked keyring or a missing Secret Service surfaces here, not
  // at construction. Translate those failures into the same actionable error.
  return {
    async setPassword(password: string) {
      try {
        await created.setPassword(password);
      } catch (error) {
        throw vaultUnavailable(error);
      }
    },
    async getPassword() {
      try {
        return await created.getPassword();
      } catch (error) {
        throw vaultUnavailable(error);
      }
    },
    async deletePassword() {
      try {
        return await created.deletePassword();
      } catch (error) {
        throw vaultUnavailable(error);
      }
    },
  };
}

export async function saveCloudCredential(
  credential: StoredCloudCredential,
  dependencies: CloudCredentialStoreDependencies = {},
) {
  const location = paths(dependencies);
  let previousProfile: StoredCloudProfile | null = null;
  try {
    previousProfile = parseProfile(await readFile(location.profile, 'utf8'));
  } catch {
    // A new login must be able to replace a missing or malformed profile; the
    // only thing lost is the chance to purge a superseded vault entry.
    previousProfile = null;
  }
  const cloudUrl = normalizeCloudOrigin(credential.cloudUrl);
  const deploymentEndpoint = normalizeCloudDeploymentEndpoint(
    credential.deploymentEndpoint,
    cloudUrl,
  );
  if (!Number.isFinite(Date.parse(credential.expiresAt))
    || credential.scope !== CLOUD_DEPLOYMENT_SCOPE) {
    throw new Error('Cannot store an invalid Hypequery Cloud credential.');
  }
  const keychainAccount = cloudUrl;
  const keyring = await entry(keychainAccount, dependencies);
  const previousPassword = await keyring.getPassword();
  await keyring.setPassword(credential.token);

  const profile: StoredCloudProfile = {
    version: 1,
    cloudUrl,
    deploymentEndpoint,
    expiresAt: credential.expiresAt,
    scope: credential.scope,
    ...(credential.target ? { target: credential.target } : {}),
    keychainAccount,
  };
  const temporary = `${location.profile}.${randomUUID()}.tmp`;
  try {
    await mkdir(location.directory, { recursive: true, mode: 0o700 });
    await chmod(location.directory, 0o700);
    await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, location.profile);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (previousPassword === null) {
      await keyring.deletePassword().catch(() => undefined);
    } else {
      await keyring.setPassword(previousPassword).catch(() => undefined);
    }
    throw error;
  }
  if (previousProfile && previousProfile.keychainAccount !== keychainAccount) {
    try {
      const previousKeyring = await entry(
        previousProfile.keychainAccount,
        dependencies,
      );
      await previousKeyring.deletePassword();
    } catch {
      // The new profile is already committed; the previous token will expire.
    }
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
  const token = await keyring.getPassword();
  if (!token) {
    throw new Error('The Hypequery Cloud token is missing from your credential vault. Run `hypequery login` again.');
  }
  return {
    cloudUrl: profile.cloudUrl,
    deploymentEndpoint: profile.deploymentEndpoint,
    expiresAt: profile.expiresAt,
    scope: profile.scope,
    ...(profile.target ? { target: profile.target } : {}),
    token,
  };
}

/**
 * Recovers just the vault account from a profile that failed validation, so a
 * corrupted profile can still be cleaned up. Only the account is salvaged, and
 * only under our own keychain service, so the worst a tampered value can do is
 * delete another Hypequery entry that `hypequery login` recreates.
 */
function salvageKeychainAccount(input: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const account = (parsed as { keychainAccount?: unknown }).keychainAccount;
  return typeof account === 'string'
    && account.length > 0
    && account.length <= MAX_KEYCHAIN_ACCOUNT_LENGTH
    ? account
    : null;
}

export async function deleteCloudCredential(
  dependencies: CloudCredentialStoreDependencies = {},
) {
  const location = paths(dependencies);
  let contents: string | null = null;
  try {
    contents = await readFile(location.profile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (contents !== null) {
    let account: string | null;
    try {
      account = parseProfile(contents).keychainAccount;
    } catch {
      // `logout` is what users reach for when their profile is broken, so a
      // malformed profile has to stay removable instead of throwing here.
      account = salvageKeychainAccount(contents);
    }
    if (account !== null) {
      const keyring = await entry(account, dependencies).catch(() => null);
      await keyring?.deletePassword().catch(() => undefined);
    }
  }
  await unlink(location.profile).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
}
