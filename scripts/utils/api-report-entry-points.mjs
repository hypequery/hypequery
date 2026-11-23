// Entry points of a package's public API, read from package.json `exports`:
// each subpath with a `types` condition gets one API report.

/** "." -> "index", "./schemas" -> "schemas", "./a/b" -> "a-b". */
export function reportNameForSubpath(subpath) {
  if (subpath === '.') return 'index';
  return subpath.replace(/^\.\//, '').replace(/[^a-zA-Z0-9]+/g, '-');
}

export function apiReportEntryPoints(packageJson) {
  const exportsField = packageJson.exports;
  if (!exportsField || typeof exportsField === 'string') {
    if (!packageJson.types) throw new Error(`${packageJson.name} declares no types entry point`);
    return [{ subpath: '.', types: packageJson.types, reportName: 'index' }];
  }
  return Object.entries(exportsField)
    .filter(([subpath, target]) => !subpath.includes('*') && target && typeof target === 'object' && typeof target.types === 'string')
    .map(([subpath, target]) => ({ subpath, types: target.types.replace(/^\.\//, ''), reportName: reportNameForSubpath(subpath) }))
    .sort((a, b) => a.reportName.localeCompare(b.reportName));
}
