// "A public API change needs a Consumer-breaking: declaration." A PR that
// changes a committed API report must add a changeset for that package whose
// summary has a `Consumer-breaking:` line: `Consumer-breaking: no` for purely
// additive changes, otherwise what breaks and how consumers migrate.

const REPORT_PATH = /^packages\/([^/]+)\/api-report\/[^/]+\.api\.md$/;
const CONSUMER_BREAKING = /^Consumer-breaking:[ \t]*(\S.*)$/im;

/** Package directories (e.g. "protocol") whose API reports a diff touches. */
export function changedReportDirs(changedFiles) {
  const dirs = new Set();
  for (const file of changedFiles) {
    const match = REPORT_PATH.exec(file);
    if (match) dirs.add(match[1]);
  }
  return [...dirs].sort();
}

/** Parse a changeset file: the packages in its front matter and its summary. */
export function parseChangeset(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.trimStart());
  if (!match) return { packages: [], summary: text };
  const packages = [];
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch)\s*$/.exec(line);
    if (entry) packages.push(entry[1].trim());
  }
  return { packages, summary: match[2] };
}

/** The `Consumer-breaking:` value of a changeset summary, or null. */
export function consumerBreakingValue(summary) {
  const match = CONSUMER_BREAKING.exec(summary ?? '');
  return match ? match[1].trim() : null;
}

/**
 * `reportPackages` maps each changed report's package name to its directory.
 * `changesets` are parsed added changesets. Returns one problem per package
 * whose API changed without a declaring changeset.
 */
export function findUndeclaredApiChanges(reportPackages, changesets) {
  const problems = [];
  for (const name of reportPackages) {
    const covering = changesets.filter((changeset) => changeset.packages.includes(name));
    if (covering.length === 0) {
      problems.push({ name, reason: 'no changeset in this PR bumps the package' });
    } else if (!covering.some((changeset) => consumerBreakingValue(changeset.summary))) {
      problems.push({ name, reason: 'its changeset has no `Consumer-breaking:` line' });
    }
  }
  return problems;
}
