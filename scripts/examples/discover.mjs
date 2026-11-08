#!/usr/bin/env node
/**
 * List registry entries for the examples CI matrix.
 *
 *   node scripts/examples/discover.mjs            # JSON array on stdout
 *   node scripts/examples/discover.mjs --root DIR # another repo root
 *
 * An entry is a folder under examples/ or recipes/ whose name does not start
 * with "_" or "." and that holds its manifest (example.json / recipe.json).
 * Folders without a manifest are listed too, so the matrix job fails on them
 * loudly instead of silently skipping a half-added example; the validator in
 * `pnpm lint` reports the missing file.
 *
 * Prints `[]` when there is nothing, which the workflow turns into a skipped
 * matrix rather than a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTRY_ROOTS = [
  { dir: 'examples', kind: 'example', manifest: 'example.json' },
  { dir: 'recipes', kind: 'recipe', manifest: 'recipe.json' },
];

export function isRegistryEntry(name) {
  return !name.startsWith('_') && !name.startsWith('.');
}

function readPackageName(dir) {
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) return null;
  try {
    const name = JSON.parse(fs.readFileSync(file, 'utf8')).name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

export function discover(repoRoot) {
  const entries = [];
  for (const root of REGISTRY_ROOTS) {
    const abs = path.join(repoRoot, root.dir);
    if (!fs.existsSync(abs)) continue;
    const names = fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isRegistryEntry(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      entries.push({
        dir: `${root.dir}/${name}`,
        kind: root.kind,
        slug: name,
        hasManifest: fs.existsSync(path.join(abs, name, root.manifest)),
        // Turbo's `<package>^...` filter (dependencies only) needs the
        // workspace package name; the directory form includes the package.
        package: readPackageName(path.join(abs, name)),
      });
    }
  }
  return entries;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const rootIndex = process.argv.indexOf('--root');
  const repoRoot = rootIndex === -1 ? path.resolve(fileURLToPath(import.meta.url), '..', '..', '..') : path.resolve(process.argv[rootIndex + 1]);
  process.stdout.write(`${JSON.stringify(discover(repoRoot))}\n`);
}
