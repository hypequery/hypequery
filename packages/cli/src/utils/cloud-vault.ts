/**
 * The operating-system credential vault (Keychain, Credential Manager, Secret
 * Service) through the optional `@napi-rs/keyring` dependency. Cloud tokens
 * live here; only metadata goes to disk.
 */
export const KEYCHAIN_SERVICE = 'dev.hypequery.cli';

export interface KeyringEntry {
  setPassword(password: string): void | Promise<void>;
  getPassword(): string | null | Promise<string | null>;
  deletePassword(): unknown;
}

export interface VaultEntry {
  setPassword(password: string): Promise<void>;
  getPassword(): Promise<string | null>;
  deletePassword(): Promise<unknown>;
}

export type CreateKeyringEntry = (
  service: string,
  account: string,
) => Promise<KeyringEntry> | KeyringEntry;

/** Marks every vault failure, so callers can tell it from a filesystem error. */
export class VaultUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      'The operating-system credential vault is unavailable. '
      + 'Install its keyring service or use HYPEQUERY_API_TOKEN for manual authentication.',
      { cause },
    );
    this.name = 'VaultUnavailableError';
  }
}

async function defaultKeyringEntry(service: string, account: string) {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry(service, account);
  } catch (error) {
    throw new VaultUnavailableError(error);
  }
}

/** One vault entry under the CLI's service; every failure is a `VaultUnavailableError`. */
export async function openVaultEntry(
  account: string,
  create: CreateKeyringEntry = defaultKeyringEntry,
): Promise<VaultEntry> {
  let created: KeyringEntry;
  try {
    created = await create(KEYCHAIN_SERVICE, account);
  } catch (error) {
    throw error instanceof VaultUnavailableError ? error : new VaultUnavailableError(error);
  }
  // Constructing an entry is lazy — the vault is only contacted on get/set/
  // delete — so a locked keyring or a missing Secret Service surfaces here, not
  // at construction. Translate those failures into the same actionable error.
  return {
    async setPassword(password: string) {
      try {
        await created.setPassword(password);
      } catch (error) {
        throw new VaultUnavailableError(error);
      }
    },
    async getPassword() {
      try {
        return await created.getPassword();
      } catch (error) {
        throw new VaultUnavailableError(error);
      }
    },
    async deletePassword() {
      try {
        return await created.deletePassword();
      } catch (error) {
        throw new VaultUnavailableError(error);
      }
    },
  };
}
