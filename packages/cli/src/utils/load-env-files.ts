import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { envFiles } from './env-files.js';

const loadedDirectories = new Set<string>();

/**
 * Copies the variables each parsed file defines into `env`, skipping every
 * name that is already set. An earlier file wins over a later one, and a set
 * variable (from the shell, or from a directory loaded earlier) wins over
 * every file.
 */
export function applyEnvFileVariables(
  env: NodeJS.ProcessEnv,
  files: readonly Readonly<Record<string, string>>[],
): void {
  for (const variables of files) {
    for (const [name, value] of Object.entries(variables)) {
      if (!Object.prototype.hasOwnProperty.call(env, name)) env[name] = value;
    }
  }
}

/**
 * Loads the `.env*` cascade from `directory` into `process.env`.
 *
 * The files are only parsed, and the CLI copies their values itself. It never
 * overwrites a variable that is already set. `dotenv.config()` is not used,
 * because it reads its options from `process.env`: one env file could set
 * `DOTENV_CONFIG_OVERRIDE=true` and let a later file overwrite a value from
 * the shell, such as the Cloud URL.
 *
 * A directory loaded earlier (the launch directory, at startup) beats one
 * loaded later. Each directory is read once per process; `hypequery dev`
 * reloads the API on every change.
 */
export async function loadEnvFiles(directory: string): Promise<void> {
  const resolved = path.resolve(directory);
  if (loadedDirectories.has(resolved)) return;
  loadedDirectories.add(resolved);

  let parse: (source: string) => Record<string, string>;
  try {
    ({ parse } = await import('dotenv'));
  } catch {
    return; // dotenv is optional; continue if not available
  }
  const parsed: Record<string, string>[] = [];
  for (const file of envFiles(process.env.NODE_ENV)) {
    try {
      parsed.push(parse(await readFile(path.join(resolved, file), 'utf8')));
    } catch {
      // A missing or unreadable file is a no-op.
    }
  }
  applyEnvFileVariables(process.env, parsed);
}
