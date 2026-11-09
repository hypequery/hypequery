// Parses the CHANGELOG.md files in this repository into structured releases.
//
// Handles the three formats the repo uses:
//   - Changesets:  `## 2.14.0` / `### Minor Changes` / `- bc14e60: text`
//   - Legacy:      `## [1.5.0]` / `### Features` / `- text`
//   - Towncrier:   `## 0.1.0b3 (2026-11-05)` / `- text` (no subsections)
//
// Pure and dependency-free so it runs under `tsx --test` and at render time.

export type ReleaseBump = 'major' | 'minor' | 'patch' | 'prerelease';

export interface ChangelogChange {
  /** Markdown body of one change, with the list marker and commit prefix removed. */
  markdown: string;
  /** Short commit SHA Changesets prefixes each change with, when present. */
  commit?: string;
}

export interface ChangelogSection {
  /** Heading as written (`Minor Changes`, `Features`); empty when the release has no subsections. */
  title: string;
  changes: ChangelogChange[];
}

export interface ParsedRelease {
  version: string;
  /** ISO date (YYYY-MM-DD) when the changelog heading carries one. */
  date?: string;
  sections: ChangelogSection[];
  /** `name@version` entries from Changesets' "Updated dependencies" bullets. */
  dependencyUpdates: string[];
}

const RELEASE_HEADING = /^##\s+(.+?)\s*$/;
const VERSION_HEADING = /^\[?(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)\]?(?:\s+\((\d{4}-\d{2}-\d{2})\))?$/;
const SECTION_HEADING = /^###\s+(.+?)\s*$/;
const LIST_ITEM = /^[-*+]\s+/;
const FENCE = /^\s*(```|~~~)/;
const COMMIT_PREFIX = /^([0-9a-f]{7,40}):\s+/;
const DEPENDENCY_ITEM = /^Updated dependencies\b/;
const DEPENDENCY_ENTRY = /^\s*[-*+]\s+(\S+@\S+)\s*$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(.*)$/;

function isBlank(lines: string[]): boolean {
  return lines.every((line) => line.trim() === '');
}

/** Removes one level of list-item indentation from a continuation line. */
function dedent(line: string): string {
  return line.startsWith('  ') ? line.slice(2) : line;
}

/** Splits a section body into its top-level list items. */
function splitItems(lines: string[]): string[][] {
  const items: string[][] = [];
  const preamble: string[] = [];
  let current: string[] | null = null;
  let inFence = false;

  for (const line of lines) {
    if (!inFence && LIST_ITEM.test(line)) {
      current = [line.replace(LIST_ITEM, '')];
      items.push(current);
    } else if (current) {
      current.push(dedent(line));
    } else {
      preamble.push(line);
    }

    if (FENCE.test(line)) inFence = !inFence;
  }

  return isBlank(preamble) ? items : [preamble, ...items];
}

function parseSection(title: string, lines: string[], dependencyUpdates: string[]): ChangelogSection {
  const changes: ChangelogChange[] = [];

  for (const itemLines of splitItems(lines)) {
    let markdown = itemLines.join('\n').trim();
    if (!markdown) continue;

    let commit: string | undefined;
    const commitMatch = COMMIT_PREFIX.exec(markdown);
    if (commitMatch) {
      commit = commitMatch[1];
      markdown = markdown.slice(commitMatch[0].length);
    }

    if (DEPENDENCY_ITEM.test(markdown)) {
      for (const line of itemLines) {
        const entry = DEPENDENCY_ENTRY.exec(line);
        if (entry && !dependencyUpdates.includes(entry[1])) dependencyUpdates.push(entry[1]);
      }
      continue;
    }

    changes.push(commit ? { markdown, commit } : { markdown });
  }

  return { title, changes };
}

function parseReleaseBody(lines: string[], dependencyUpdates: string[]): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let title = '';
  let body: string[] = [];
  let inFence = false;

  const flush = () => {
    const section = parseSection(title, body, dependencyUpdates);
    if (section.changes.length > 0) sections.push(section);
  };

  for (const line of lines) {
    const heading = inFence ? null : SECTION_HEADING.exec(line);
    if (heading) {
      flush();
      title = heading[1];
      body = [];
    } else {
      body.push(line);
    }
    if (FENCE.test(line)) inFence = !inFence;
  }
  flush();

  return sections;
}

/** Folds a repeated version heading into the first occurrence of that version. */
function mergeInto(target: ParsedRelease, source: ParsedRelease) {
  for (const section of source.sections) {
    const existing = target.sections.find((candidate) => candidate.title === section.title);
    if (existing) existing.changes.push(...section.changes);
    else target.sections.push(section);
  }
  for (const dependency of source.dependencyUpdates) {
    if (!target.dependencyUpdates.includes(dependency)) target.dependencyUpdates.push(dependency);
  }
  target.date ??= source.date;
}

/** Parses a CHANGELOG.md into releases, newest first (file order). */
export function parseChangelog(markdown: string): ParsedRelease[] {
  const lines = markdown
    .replace(/\r/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');

  const releases: ParsedRelease[] = [];
  const byVersion = new Map<string, ParsedRelease>();
  let current: { version: string; date?: string; lines: string[] } | null = null;
  let inFence = false;

  const flush = () => {
    if (!current) return;
    const dependencyUpdates: string[] = [];
    const release: ParsedRelease = {
      version: current.version,
      ...(current.date ? { date: current.date } : {}),
      sections: parseReleaseBody(current.lines, dependencyUpdates),
      dependencyUpdates,
    };
    current = null;
    if (release.sections.length === 0 && release.dependencyUpdates.length === 0) return;

    const existing = byVersion.get(release.version);
    if (existing) {
      mergeInto(existing, release);
    } else {
      byVersion.set(release.version, release);
      releases.push(release);
    }
  };

  let skipping = true;
  for (const line of lines) {
    const heading = inFence ? null : RELEASE_HEADING.exec(line);
    if (heading) {
      flush();
      const version = VERSION_HEADING.exec(heading[1]);
      // Non-version headings such as `## Unreleased` are skipped with their content.
      skipping = !version;
      if (version) current = { version: version[1], date: version[2], lines: [] };
    } else if (!skipping && current) {
      current.lines.push(line);
    }
    if (FENCE.test(line)) inFence = !inFence;
  }
  flush();

  return releases;
}

/**
 * Classifies a release by comparing it to the release before it. Without a
 * previous version, falls back to the shape of the version itself
 * (`x.0.0` major, `x.y.0` minor, otherwise patch).
 */
export function releaseBump(version: string, previousVersion?: string): ReleaseBump {
  const current = SEMVER.exec(version);
  if (!current || current[4]) return 'prerelease';

  const [major, minor, patch] = current.slice(1, 4).map(Number);
  const previous = previousVersion ? SEMVER.exec(previousVersion) : null;

  if (!previous) {
    if (minor === 0 && patch === 0) return 'major';
    return patch === 0 ? 'minor' : 'patch';
  }

  const [prevMajor, prevMinor] = previous.slice(1, 3).map(Number);
  if (major !== prevMajor) return 'major';
  if (minor !== prevMinor) return 'minor';
  return 'patch';
}
