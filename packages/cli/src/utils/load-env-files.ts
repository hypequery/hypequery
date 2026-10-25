import path from 'node:path';
import { envFiles } from './env-files.js';

const loadedDirectories = new Set<string>();

/**
 * Loads the `.env*` cascade from `directory` into `process.env`.
 *
 * `dotenv` never overwrites a variable that is already set, so a real
 * environment variable beats every file, and a directory loaded earlier (the
 * launch directory, at startup) beats one loaded later. Each directory is read
 * once per process; `hypequery dev` reloads the API on every change.
 */
export async function loadEnvFiles(directory: string): Promise<void> {
  const resolved = path.resolve(directory);
  if (loadedDirectories.has(resolved)) return;
  loadedDirectories.add(resolved);

  try {
    const { config } = await import('dotenv');
    for (const file of envFiles(process.env.NODE_ENV)) {
      // Missing files are a no-op.
      config({ path: path.join(resolved, file), quiet: true });
    }
  } catch {
    // dotenv is optional; continue if not available
  }
}
