import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Finds the directory that owns `filePath`: the nearest ancestor with a
 * `package.json`, or the file's own directory when there is none. Bare imports
 * in the file resolve from here, whatever the process's working directory is.
 */
export async function findProjectRoot(filePath: string): Promise<string> {
  const start = path.dirname(path.resolve(filePath));
  let dir = start;

  while (true) {
    try {
      await access(path.join(dir, 'package.json'));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return start;
      dir = parent;
    }
  }
}

/**
 * Imports `specifier` as `fromFile` would see it, so a package installed in the
 * user's project is found even when the CLI runs from elsewhere (for example
 * through `npx -y @hypequery/cli`). Falls back to `fallback` — the CLI's own
 * resolution — when the project does not have the package.
 */
export async function importFromProject<T>(
  specifier: string,
  fromFile: string,
  fallback: () => Promise<T>,
): Promise<T> {
  let resolved: string;
  try {
    resolved = createRequire(path.resolve(fromFile)).resolve(specifier);
  } catch {
    return fallback();
  }
  return import(/* @vite-ignore */ pathToFileURL(resolved).href) as Promise<T>;
}
