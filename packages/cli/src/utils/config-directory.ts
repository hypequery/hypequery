import { homedir } from 'node:os';
import path from 'node:path';
import { envFileVariableNames } from './env-provenance.js';

type ConfigDirectoryVariable = 'HYPEQUERY_CONFIG_DIR' | 'APPDATA' | 'LOCALAPPDATA' | 'XDG_CONFIG_HOME';

/**
 * A directory variable the CLI may use for its settings and credentials.
 *
 * Only the shell can choose this directory. A project `.env` file could
 * otherwise point it into the repository (`HYPEQUERY_CONFIG_DIR=./.hq`), so
 * that device sign-in without a vault writes the management token there, or
 * plant a credential store whose current sign-in is a server it chose. A
 * variable from an env file is ignored. A relative path is refused: it would
 * depend on the working directory, which is usually a project.
 */
function shellDirectory(
  env: Readonly<Record<string, string | undefined>>,
  name: ConfigDirectoryVariable,
  platform: NodeJS.Platform,
  envFileVariables: ReadonlySet<string>,
): string | undefined {
  const value = env[name];
  if (!value || envFileVariables.has(name)) return undefined;
  const absolute = platform === 'win32' ? path.win32.isAbsolute(value) : path.posix.isAbsolute(value);
  if (absolute) return value;
  if (name === 'HYPEQUERY_CONFIG_DIR') {
    throw new Error(`HYPEQUERY_CONFIG_DIR must be an absolute path, not "${value}".`);
  }
  // The XDG Base Directory spec says to ignore a relative XDG_CONFIG_HOME;
  // the same applies to the Windows variables.
  return undefined;
}

/**
 * The directory the shell environment chose for CLI settings, when it chose
 * one: `HYPEQUERY_CONFIG_DIR`, else the platform's config variable. Without
 * one, `configDirectory` falls back to the home directory.
 */
export function explicitConfigDirectory(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  envFileVariables: ReadonlySet<string> = envFileVariableNames(env),
): string | undefined {
  const override = shellDirectory(env, 'HYPEQUERY_CONFIG_DIR', platform, envFileVariables);
  if (override) return override;
  const base = platform === 'win32'
    ? shellDirectory(env, 'APPDATA', platform, envFileVariables)
      ?? shellDirectory(env, 'LOCALAPPDATA', platform, envFileVariables)
    : platform === 'darwin' ? undefined : shellDirectory(env, 'XDG_CONFIG_HOME', platform, envFileVariables);
  return base ? path.join(base, 'hypequery') : undefined;
}

/** Shared location for CLI settings and the Cloud credential profile. */
export function configDirectory(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  home = homedir(),
  envFileVariables: ReadonlySet<string> = envFileVariableNames(env),
): string {
  const explicit = explicitConfigDirectory(env, platform, envFileVariables);
  if (explicit) return explicit;
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'hypequery');
  }
  return path.join(platform === 'win32' ? home : path.join(home, '.config'), 'hypequery');
}
