import { homedir } from 'node:os';
import path from 'node:path';

/** Shared location for CLI settings and the Cloud credential profile. */
export function configDirectory(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  home = homedir(),
): string {
  if (env.HYPEQUERY_CONFIG_DIR) return env.HYPEQUERY_CONFIG_DIR;
  if (platform === 'win32') {
    return path.join(env.APPDATA ?? env.LOCALAPPDATA ?? home, 'hypequery');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'hypequery');
  }
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'hypequery');
}
