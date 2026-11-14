import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  validateProtocolDeploymentReleaseTarget,
  type ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';
import { configDirectory } from './config-directory.js';
import {
  normalizeCloudDeploymentEndpoint,
  normalizeCloudOrigin,
} from './cloud-credential-store.js';
import { isManagementTokenValue } from './cloud-token-kind.js';
import {
  openVaultEntry,
  VaultUnavailableError,
  type CreateKeyringEntry,
} from './cloud-vault.js';
import { withFileLock } from './file-lock.js';

/**
 * Management tokens (`hqmt_`), one per Cloud origin. Like the browser sign-in
 * profile, the token goes to the operating-system vault and only metadata to
 * disk. Device sign-in exists for machines without a desktop, which often have
 * no vault either, so when the vault is unavailable the token is kept in this
 * file instead: owner-only (0600) in an owner-only directory (0700).
 *
 * Every change reads the file, updates the vault and writes the file back
 * while holding the file's lock, so two sign-ins at once (to different Cloud
 * origins, say) can't drop each other's entry.
 */
const STORE_FILE = 'cloud-management-tokens.json';
const VAULT_ACCOUNT_PREFIX = 'management:';
const INVALID_STORE = 'The stored Hypequery Cloud sign-in is invalid. Run `hypequery login` again.';

export type ManagementTokenStorage = 'vault' | 'file';

export interface StoredManagementCredential {
  readonly cloudUrl: string;
  readonly token: string;
  readonly expiresAt: string;
  /** Where deploy, status, pull and diff send this token. */
  readonly deploymentEndpoint: string;
  readonly organizationId?: string;
  /** The Cloud project slug Cloud named, if any. */
  readonly project?: string;
  /** True when the token can change only `project`. */
  readonly projectLimited: boolean;
  /** What the token could do when issued; Cloud re-checks every call. */
  readonly capabilities?: readonly string[];
  /** The deployment target commands default to, when Cloud named one. */
  readonly target?: ProtocolDeploymentReleaseTarget;
  readonly signedInWith: 'browser' | 'device';
}

interface StoredEntry {
  readonly expiresAt: string;
  readonly deploymentEndpoint: string;
  readonly organizationId?: string;
  readonly project?: string;
  readonly projectLimited: boolean;
  readonly capabilities?: readonly string[];
  readonly target?: ProtocolDeploymentReleaseTarget;
  readonly signedInWith: 'browser' | 'device';
  readonly storage: ManagementTokenStorage;
  /** Only when `storage` is `file`. */
  readonly token?: string;
}

interface StoreFile {
  readonly version: 1;
  /** The origin of the most recent sign-in: the default when HYPEQUERY_CLOUD_URL is unset. */
  readonly current: string | null;
  readonly origins: Readonly<Record<string, StoredEntry>>;
}

export interface ManagementTokenStoreDependencies {
  readonly configDirectory?: string;
  readonly createKeyringEntry?: CreateKeyringEntry;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
}

function location(dependencies: ManagementTokenStoreDependencies) {
  const directory = dependencies.configDirectory
    ?? configDirectory(dependencies.env ?? process.env, dependencies.platform ?? process.platform);
  return { directory, file: path.join(directory, STORE_FILE) };
}

function vaultAccount(origin: string) {
  return `${VAULT_ACCOUNT_PREFIX}${origin}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 256);
}

function parseEntry(origin: string, input: unknown): StoredEntry {
  if (!isRecord(input)) throw new Error(INVALID_STORE);
  const capabilities = input.capabilities;
  if (
    typeof input.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(input.expiresAt))
    || typeof input.deploymentEndpoint !== 'string'
    || !optionalString(input.organizationId)
    || !optionalString(input.project)
    || typeof input.projectLimited !== 'boolean'
    || (capabilities !== undefined
      && (!Array.isArray(capabilities) || !capabilities.every(value => typeof value === 'string')))
    || (input.signedInWith !== 'browser' && input.signedInWith !== 'device')
    || (input.storage !== 'vault' && input.storage !== 'file')
    || (input.storage === 'file' ? !isManagementTokenValue(input.token) : input.token !== undefined)
  ) {
    throw new Error(INVALID_STORE);
  }
  let deploymentEndpoint: string;
  let target: ProtocolDeploymentReleaseTarget | undefined;
  try {
    deploymentEndpoint = normalizeCloudDeploymentEndpoint(input.deploymentEndpoint, origin);
    target = input.target === undefined ? undefined : validateProtocolDeploymentReleaseTarget(input.target);
  } catch {
    throw new Error(INVALID_STORE);
  }
  return {
    expiresAt: input.expiresAt,
    deploymentEndpoint,
    ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
    ...(input.project !== undefined ? { project: input.project } : {}),
    projectLimited: input.projectLimited,
    ...(capabilities !== undefined ? { capabilities: [...capabilities as string[]] } : {}),
    ...(target ? { target } : {}),
    signedInWith: input.signedInWith,
    storage: input.storage,
    ...(input.storage === 'file' ? { token: input.token as string } : {}),
  };
}

function parseStore(text: string): StoreFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(INVALID_STORE);
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.origins)
    || (parsed.current !== null && typeof parsed.current !== 'string')) {
    throw new Error(INVALID_STORE);
  }
  const origins: Record<string, StoredEntry> = {};
  for (const [key, value] of Object.entries(parsed.origins)) {
    let origin: string;
    try {
      origin = normalizeCloudOrigin(key);
    } catch {
      throw new Error(INVALID_STORE);
    }
    if (origin !== key) throw new Error(INVALID_STORE);
    origins[origin] = parseEntry(origin, value);
  }
  const current = typeof parsed.current === 'string' && parsed.current in origins ? parsed.current : null;
  return { version: 1, current, origins };
}

async function readStore(file: string): Promise<StoreFile | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return parseStore(text);
}

async function writeStore(directory: string, file: string, store: StoreFile) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function deleteVaultToken(origin: string, dependencies: ManagementTokenStoreDependencies) {
  try {
    const entry = await openVaultEntry(vaultAccount(origin), dependencies.createKeyringEntry);
    await entry.deletePassword();
  } catch {
    // Nothing to clean up, or no vault to clean it from.
  }
}

/**
 * Stores a management token for its Cloud origin and makes that origin the
 * default. Returns where the token went, so `login` can say when it is a file.
 */
export async function saveManagementCredential(
  credential: StoredManagementCredential,
  dependencies: ManagementTokenStoreDependencies = {},
): Promise<{ readonly storage: ManagementTokenStorage; readonly path: string }> {
  const { directory, file } = location(dependencies);
  const origin = normalizeCloudOrigin(credential.cloudUrl);
  if (!isManagementTokenValue(credential.token) || !Number.isFinite(Date.parse(credential.expiresAt))) {
    throw new Error('Cannot store an invalid Hypequery Cloud management token.');
  }
  return withFileLock(file, async () => {
    let previous: StoreFile | null;
    try {
      previous = await readStore(file);
    } catch {
      // A new sign-in must be able to replace a malformed store.
      previous = null;
    }

    let storage: ManagementTokenStorage = 'vault';
    let previousPassword: string | null = null;
    let vault: Awaited<ReturnType<typeof openVaultEntry>> | null = null;
    try {
      vault = await openVaultEntry(vaultAccount(origin), dependencies.createKeyringEntry);
      previousPassword = await vault.getPassword();
      await vault.setPassword(credential.token);
    } catch (error) {
      if (!(error instanceof VaultUnavailableError)) throw error;
      storage = 'file';
      vault = null;
    }

    const entry: StoredEntry = {
      expiresAt: credential.expiresAt,
      deploymentEndpoint: normalizeCloudDeploymentEndpoint(credential.deploymentEndpoint, origin),
      ...(credential.organizationId !== undefined ? { organizationId: credential.organizationId } : {}),
      ...(credential.project !== undefined ? { project: credential.project } : {}),
      projectLimited: credential.projectLimited,
      ...(credential.capabilities !== undefined ? { capabilities: [...credential.capabilities] } : {}),
      ...(credential.target ? { target: credential.target } : {}),
      signedInWith: credential.signedInWith,
      storage,
      ...(storage === 'file' ? { token: credential.token } : {}),
    };
    const next: StoreFile = {
      version: 1,
      current: origin,
      origins: { ...(previous?.origins ?? {}), [origin]: entry },
    };
    try {
      await writeStore(directory, file, next);
    } catch (error) {
      if (vault) {
        if (previousPassword === null) await vault.deletePassword().catch(() => undefined);
        else await vault.setPassword(previousPassword).catch(() => undefined);
      }
      throw error;
    }
    // A token that moved from the vault to the file must not linger in the vault.
    if (storage === 'file' && previous?.origins[origin]?.storage === 'vault') {
      await deleteVaultToken(origin, dependencies);
    }
    return { storage, path: file };
  });
}

async function materialize(
  origin: string,
  entry: StoredEntry,
  dependencies: ManagementTokenStoreDependencies,
): Promise<StoredManagementCredential> {
  let token = entry.token;
  if (entry.storage === 'vault') {
    const vault = await openVaultEntry(vaultAccount(origin), dependencies.createKeyringEntry);
    token = (await vault.getPassword()) ?? undefined;
    if (!token) {
      throw new Error('The Hypequery Cloud management token is missing from your credential vault. Run `hypequery login` again.');
    }
  }
  return {
    cloudUrl: origin,
    token: token as string,
    expiresAt: entry.expiresAt,
    deploymentEndpoint: entry.deploymentEndpoint,
    ...(entry.organizationId !== undefined ? { organizationId: entry.organizationId } : {}),
    ...(entry.project !== undefined ? { project: entry.project } : {}),
    projectLimited: entry.projectLimited,
    ...(entry.capabilities !== undefined ? { capabilities: entry.capabilities } : {}),
    ...(entry.target ? { target: entry.target } : {}),
    signedInWith: entry.signedInWith,
  };
}

/**
 * The management token for `cloudUrl`, or for the origin of the most recent
 * sign-in when it is omitted. Null when there is none.
 */
export async function loadManagementCredential(
  options: { readonly cloudUrl?: string } = {},
  dependencies: ManagementTokenStoreDependencies = {},
): Promise<StoredManagementCredential | null> {
  const store = await readStore(location(dependencies).file);
  if (!store) return null;
  const origin = options.cloudUrl === undefined ? store.current : normalizeCloudOrigin(options.cloudUrl);
  if (origin === null) return null;
  const entry = store.origins[origin];
  return entry ? materialize(origin, entry, dependencies) : null;
}

/**
 * Every stored management token, for `logout`. A token that can't be read is
 * skipped and counted, so logout still removes local state.
 */
export async function loadAllManagementCredentials(
  dependencies: ManagementTokenStoreDependencies = {},
): Promise<{ readonly credentials: readonly StoredManagementCredential[]; readonly unreadable: number }> {
  let store: StoreFile | null;
  try {
    store = await readStore(location(dependencies).file);
  } catch {
    return { credentials: [], unreadable: 1 };
  }
  const credentials: StoredManagementCredential[] = [];
  let unreadable = 0;
  for (const [origin, entry] of Object.entries(store?.origins ?? {})) {
    try {
      credentials.push(await materialize(origin, entry, dependencies));
    } catch {
      unreadable += 1;
    }
  }
  return { credentials, unreadable };
}

/** The origins named in a store file, even one that fails validation. */
function salvageOrigins(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.origins)) return [];
    return Object.keys(parsed.origins).flatMap((key) => {
      try {
        return [normalizeCloudOrigin(key)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/**
 * Removes the management token for `cloudUrl`, or every stored management
 * token when it is omitted. A malformed store is still removed.
 *
 * `clearDefault` is for a sign-in to `cloudUrl` that left no management token
 * (a Cloud without them): no other origin's token stays the default either,
 * so commands follow the sign-in that just happened, not an older one to
 * another Cloud. Other origins' tokens stay stored for `HYPEQUERY_CLOUD_URL`.
 */
export async function deleteManagementCredentials(
  options: { readonly cloudUrl?: string; readonly clearDefault?: boolean } = {},
  dependencies: ManagementTokenStoreDependencies = {},
): Promise<void> {
  const { directory, file } = location(dependencies);
  // Nothing stored: don't create the config directory just to hold a lock.
  if (!await exists(file)) return;
  await withFileLock(file, async () => {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (options.cloudUrl !== undefined) {
      const origin = normalizeCloudOrigin(options.cloudUrl);
      let store: StoreFile | null = null;
      try {
        store = parseStore(text);
      } catch {
        store = null;
      }
      if (store) {
        const current = options.clearDefault || store.current === origin ? null : store.current;
        if (!(origin in store.origins) && current === store.current) return;
        if (origin in store.origins) await deleteVaultToken(origin, dependencies);
        const origins = Object.fromEntries(Object.entries(store.origins).filter(([key]) => key !== origin));
        if (Object.keys(origins).length > 0) {
          await writeStore(directory, file, { version: 1, current, origins });
          return;
        }
        await unlink(file).catch(ignoreMissing);
        return;
      }
    }
    for (const origin of salvageOrigins(text)) await deleteVaultToken(origin, dependencies);
    await unlink(file).catch(ignoreMissing);
  });
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function ignoreMissing(error: unknown) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
