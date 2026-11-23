// Reads the package.json of every directory under packages/. Published npm
// packages all live there; examples and recipes are private.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function readWorkspacePackages(root = process.cwd()) {
  const packagesDir = join(root, 'packages');
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name, 'package.json'))
    .filter((file) => existsSync(file))
    .map((file) => ({ ...JSON.parse(readFileSync(file, 'utf8')), dir: file.slice(root.length + 1, -'/package.json'.length) }));
}
