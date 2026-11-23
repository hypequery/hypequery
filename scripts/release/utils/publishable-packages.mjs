// Which workspace packages a release publishes, and how to name them in
// reports. Pure helpers: callers read package.json files and npm themselves.

/** A package changesets publishes: public, named, versioned. */
export function isPublishable(packageJson) {
  return Boolean(packageJson && packageJson.private !== true && packageJson.name && packageJson.version);
}

/**
 * The `{ name, version }` list a release publishes, sorted by name. With
 * `prerelease` set (e.g. "canary"), keeps only snapshot versions carrying that
 * tag, which is what `changeset version --snapshot <tag>` produces.
 */
export function publishablePackages(packageJsons, { prerelease } = {}) {
  return packageJsons
    .filter(isPublishable)
    .filter((pkg) => !prerelease || pkg.version.includes(`-${prerelease}-`))
    .map((pkg) => ({ name: pkg.name, version: pkg.version }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse a JSON `[{ name, version }]` list, rejecting any other shape. */
export function parsePackageList(text, source = 'package list') {
  if (text === undefined || text === null || String(text).trim() === '') return [];
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(value)) throw new Error(`${source} must be a JSON array`);
  for (const entry of value) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.version !== 'string') {
      throw new Error(`${source} entries must be { "name": string, "version": string }`);
    }
  }
  return value.map(({ name, version }) => ({ name, version }));
}

/** Union of package lists, de-duplicated on name@version, sorted. */
export function mergePackageLists(...lists) {
  const seen = new Map();
  for (const list of lists) {
    for (const pkg of list ?? []) seen.set(`${pkg.name}@${pkg.version}`, pkg);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function packageSpec(pkg) {
  return `${pkg.name}@${pkg.version}`;
}
