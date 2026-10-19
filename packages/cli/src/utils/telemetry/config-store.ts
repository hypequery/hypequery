import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configDirectory } from '../config-directory.js';
import { parseTelemetryConfig, TELEMETRY_SCHEMA_VERSION, type TelemetryConfig } from './config-schema.js';
import { matchesTelemetryFormat } from './value-formats.js';
import { acquireSettingsLock, type SettingsLock, type SettingsLockIdentity } from './settings-lock.js';

export interface TelemetryConfigDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly configDirectory?: string;
  /** Lock owner identity; tests use it to model separate processes. */
  readonly lockIdentity?: SettingsLockIdentity;
}

/** Settings writes in progress; each holds the cross-process lock until it settles. */
const activeWrites = new Set<Promise<unknown>>();

/**
 * Waits, bounded, for in-progress settings writes to release their lock. The
 * executable calls this before exiting, including on signals: process.exit()
 * skips `finally` blocks, and a stranded lock would make every later
 * preference change fail until someone removed it by hand.
 */
export async function settleTelemetrySettings(timeoutMs = 250): Promise<void> {
  if (activeWrites.size === 0) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled([...activeWrites]),
    new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); timer.unref(); }),
  ]);
  clearTimeout(timer);
}

export class TelemetryConfigStore {
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly dependencies: TelemetryConfigDependencies = {}) {
    this.env = dependencies.env ?? process.env;
    this.platform = dependencies.platform ?? process.platform;
  }

  private async directory(): Promise<string | null> {
    if (this.dependencies.configDirectory) return this.dependencies.configDirectory;
    const home = this.platform === 'win32' ? this.env.USERPROFILE : this.env.HOME;
    const explicit = this.env.HYPEQUERY_CONFIG_DIR
      || (this.platform === 'win32' ? this.env.APPDATA || this.env.LOCALAPPDATA
        : this.platform !== 'darwin' ? this.env.XDG_CONFIG_HOME : undefined);
    if (!explicit && (!home || !(await stat(home)).isDirectory())) return null;
    return configDirectory(this.env, this.platform, home ?? '');
  }

  /** Read/create settings only when collection is allowed. All failures fail closed. */
  async load(): Promise<TelemetryConfig | null> {
    return this.update();
  }

  /** Inspect without creating an identity or changing a disabled installation. */
  async peek(): Promise<TelemetryConfig | null> {
    try {
      const directory = await this.directory();
      return directory
        ? parseTelemetryConfig(await readFile(path.join(directory, 'telemetry.json'), 'utf8'))
        : null;
    } catch {
      return null;
    }
  }

  async setEnabled(enabled: boolean): Promise<TelemetryConfig | null> {
    return this.update(enabled);
  }

  /** Serialize display and persistence so concurrent interactive runs show one notice. */
  async showNotice(write: () => Promise<void>, now = new Date()): Promise<TelemetryConfig | null> {
    return this.update(undefined, async config => {
      if (!config.enabled || config.notice_shown_at) return config;
      await write();
      return { ...config, notice_shown_at: now.toISOString() };
    });
  }

  /** Kill switch from an HTTP 410. One immediate lock attempt; never waits for another writer. */
  async disableVersion(version: string): Promise<TelemetryConfig | null> {
    if (!matchesTelemetryFormat('version', version)) return null;
    return this.update(undefined, async config => ({
      ...config,
      disabled_cli_versions: [...new Set([...(config.disabled_cli_versions ?? []), version])].slice(-20),
    }), 1, true);
  }

  private update(
    enabled?: boolean,
    mutate?: (config: TelemetryConfig) => Promise<TelemetryConfig>,
    lockAttempts = 20,
    requireExisting = false,
  ): Promise<TelemetryConfig | null> {
    const write = this.locked(enabled, mutate, lockAttempts, requireExisting);
    activeWrites.add(write);
    void write.finally(() => activeWrites.delete(write));
    return write;
  }

  private async locked(
    enabled: boolean | undefined,
    mutate: ((config: TelemetryConfig) => Promise<TelemetryConfig>) | undefined,
    lockAttempts: number,
    requireExisting: boolean,
  ): Promise<TelemetryConfig | null> {
    let lock: SettingsLock | null = null;
    let temporary: string | undefined;
    try {
      const directory = await this.directory();
      if (!directory) return null;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // Serialize read-modify-write across processes, including first identity
      // creation. A live writer's lock fails closed however long it is held; a
      // lock whose owner process has died is taken over (see settings-lock.ts).
      lock = await acquireSettingsLock(directory, lockAttempts, this.dependencies.lockIdentity);
      if (!lock) return null;
      const file = path.join(directory, 'telemetry.json');
      let previous: TelemetryConfig | null = null;
      try {
        previous = parseTelemetryConfig(await readFile(file, 'utf8'));
        // Explicit enable/disable can repair settings; ordinary commands cannot.
        if (!previous && enabled === undefined) return null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      // The kill switch only amends settings that collection already created.
      if (!previous && requireExisting) return null;
      let config: TelemetryConfig = {
        schema_version: TELEMETRY_SCHEMA_VERSION,
        install_id: previous?.install_id ?? randomUUID(),
        enabled: enabled ?? previous?.enabled ?? true,
        ...(previous?.notice_shown_at ? { notice_shown_at: previous.notice_shown_at } : {}),
        ...(previous?.disabled_cli_versions ? { disabled_cli_versions: previous.disabled_cli_versions } : {}),
      };
      if (previous && enabled === undefined) config = previous;
      if (mutate) config = await mutate(config);
      if (previous && enabled === undefined && (!mutate || config === previous)) return previous;
      temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await rename(temporary, file);
      return config;
    } catch {
      return null;
    } finally {
      if (temporary) await unlink(temporary).catch(() => undefined);
      // Releases only this writer's ownership, never a lock taken over by another.
      if (lock) await lock.release();
    }
  }
}
