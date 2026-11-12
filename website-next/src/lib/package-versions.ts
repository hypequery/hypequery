import fs from 'node:fs';
import path from 'node:path';

/**
 * Current versions of the published hypequery packages, read from the monorepo
 * checkout at build time: `@hypequery/*` from packages/<pkg>/package.json and
 * the PyPI `hypequery` from python/hypequery/pyproject.toml. `hypequery create`
 * pins a scaffold's `workspace:*` dependencies to these via /examples.json.
 *
 * Not stored in the committed registry on purpose: every release bump on main
 * would otherwise turn the registry freshness check red on open examples PRs.
 * Server-only (uses fs); outside the monorepo it returns an empty map.
 */
export function readPackageVersions(repoRoot = path.resolve(process.cwd(), '..')): Record<string, string> {
  const versions: Record<string, string> = {};
  const packagesDir = path.join(repoRoot, 'packages');
  if (fs.existsSync(packagesDir)) {
    for (const dir of fs.readdirSync(packagesDir).sort()) {
      const file = path.join(packagesDir, dir, 'package.json');
      if (!fs.existsSync(file)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: string; version?: string; private?: boolean };
        if (pkg.name?.startsWith('@hypequery/') && pkg.version && !pkg.private) versions[pkg.name] = pkg.version;
      } catch {
        // not a package we care about
      }
    }
  }
  const pyproject = path.join(repoRoot, 'python', 'hypequery', 'pyproject.toml');
  if (fs.existsSync(pyproject)) {
    const match = /^version\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(pyproject, 'utf8'));
    if (match) versions.hypequery = match[1];
  }
  return versions;
}
