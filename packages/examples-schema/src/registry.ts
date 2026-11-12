import fs from 'node:fs';
import path from 'node:path';
import type { Manifest } from './manifest.js';
import { validateRegistry, type ValidationIssue } from './validate.js';

/**
 * The published registry: every manifest plus the files the site renders.
 * It is generated into `website-next/src/data/examples-registry.json` and
 * committed, because the website is an npm project that cannot import this
 * pnpm workspace package. `pnpm lint` fails when the file is stale.
 */
export interface RegistryEntry {
  manifest: Manifest;
  /** Repo-relative folder, e.g. `examples/nextjs-dashboard`. */
  dir: string;
  /**
   * README.md (examples, recipes) or guide.md (guides) with the leading H1
   * kept; the site decides what to strip. Guide bodies have their
   * `{{sql:<file>}}` lines expanded into fenced SQL blocks.
   */
  readme: string;
  /** Absent for guides, which have no single key file. */
  keyFile?: { path: string; language: string; source: string };
  /** Present for guides only: the CI-tested SQL files, in run order. */
  guide?: { sqlFiles: Array<{ path: string; source: string }> };
  /** Present for recipes only. */
  recipe?: {
    dataset: { path: string; language: string; source: string };
    expectedSql: string;
    output: string;
  };
  /** Site path of the copied screenshot, when the folder has one. */
  screenshot?: string;
}

export interface Registry {
  /** Bump when the shape of entries changes. */
  version: 1;
  /**
   * Package versions are not part of the committed registry: every release
   * bump on main would make the committed file stale and turn the registry
   * check red on open examples PRs. Consumers that need them (the website's
   * `/examples.json`, the template publisher) call `readPackageVersions` at
   * build time instead.
   */
  entries: RegistryEntry[];
}

export interface BuildRegistryOptions {
  repoRoot: string;
  /** Where screenshots are copied to, e.g. `website-next/public`. Omit to skip. */
  publicDir?: string;
  /**
   * Folder holding the site's App Router pages, used to check that every
   * `leadPages` entry is a real page. Omit to skip the check.
   */
  appDir?: string;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.sql': 'sql',
  '.json': 'json',
  '.md': 'markdown',
  '.yml': 'yaml',
  '.yaml': 'yaml',
};

export function languageForFile(file: string): string {
  return LANGUAGE_BY_EXT[path.extname(file).toLowerCase()] ?? 'text';
}

function readFile(dirAbs: string, relative: string): { path: string; language: string; source: string } {
  return {
    path: relative,
    language: languageForFile(relative),
    source: fs.readFileSync(path.join(dirAbs, relative), 'utf8'),
  };
}

/**
 * Replace `{{sql:<file>}}` lines with the file's contents in a fenced block,
 * so the guide text and the CI-tested SQL are one copy. Unknown files are
 * reported as issues rather than silently dropped.
 */
export function expandSqlIncludes(markdown: string, dirAbs: string, dirRel: string, issues: ValidationIssue[]): string {
  return markdown.replace(/^\{\{sql:([^}\s]+)\}\}[ \t]*$/gm, (_match, file: string) => {
    const abs = path.join(dirAbs, file);
    if (!abs.startsWith(path.resolve(dirAbs) + path.sep) || !fs.existsSync(abs)) {
      issues.push({ file: `${dirRel}/guide.md`, message: `{{sql:${file}}} refers to a file that does not exist in ${dirRel}/` });
      return `<!-- missing ${file} -->`;
    }
    return `\`\`\`sql\n${fs.readFileSync(abs, 'utf8').trim()}\n\`\`\``;
  });
}

function leadPageExists(appDir: string, leadPage: string): boolean {
  const segments = leadPage.split('/').filter(Boolean);
  return fs.existsSync(path.join(appDir, ...segments, 'page.tsx')) || fs.existsSync(path.join(appDir, ...segments, 'page.mdx'));
}

/** Build the registry; throws with every validation issue when the registry is invalid. */
export function buildRegistry(options: BuildRegistryOptions): Registry {
  const { manifests, issues } = validateRegistry(options.repoRoot);
  const extraIssues: ValidationIssue[] = [];

  const entries: RegistryEntry[] = manifests.map(({ dir, manifest }) => {
    const dirAbs = path.join(options.repoRoot, dir);
    const entry: RegistryEntry =
      manifest.kind === 'guide'
        ? {
            manifest,
            dir,
            readme: expandSqlIncludes(fs.readFileSync(path.join(dirAbs, 'guide.md'), 'utf8'), dirAbs, dir, extraIssues),
            guide: { sqlFiles: manifest.sqlFiles.map((file) => ({ path: file, source: fs.readFileSync(path.join(dirAbs, file), 'utf8') })) },
          }
        : {
            manifest,
            dir,
            readme: fs.readFileSync(path.join(dirAbs, 'README.md'), 'utf8'),
            keyFile: readFile(dirAbs, manifest.keyFile),
          };
    if (manifest.kind === 'recipe') {
      entry.recipe = {
        dataset: readFile(dirAbs, manifest.datasetFile),
        expectedSql: fs.readFileSync(path.join(dirAbs, manifest.expectedSqlFile), 'utf8'),
        output: fs.readFileSync(path.join(dirAbs, manifest.outputFile), 'utf8'),
      };
    }
    const screenshot = path.join(dirAbs, 'screenshot.png');
    if (fs.existsSync(screenshot)) {
      const sitePath = `/${manifest.kind === 'example' ? 'examples' : manifest.kind === 'recipe' ? 'recipes' : 'guides'}/${manifest.slug}/screenshot.png`;
      entry.screenshot = sitePath;
      if (options.publicDir) {
        const target = path.join(options.publicDir, sitePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(screenshot, target);
      }
    }
    if (options.appDir) {
      for (const leadPage of manifest.leadPages) {
        if (!leadPageExists(options.appDir, leadPage)) {
          extraIssues.push({ file: `${dir}/${manifest.kind}.json`, message: `leadPages entry "${leadPage}" has no page under ${path.relative(options.repoRoot, options.appDir)}/` });
        }
      }
    }
    return entry;
  });

  const all = [...issues, ...extraIssues];
  if (all.length > 0) {
    const error = new Error(`Examples registry has ${all.length} problem${all.length === 1 ? '' : 's'}`);
    (error as Error & { issues: ValidationIssue[] }).issues = all;
    throw error;
  }

  entries.sort((a, b) => a.manifest.slug.localeCompare(b.manifest.slug));
  return { version: 1, entries };
}

/**
 * `@hypequery/<name>` → version from every public package under packages/,
 * plus the PyPI `hypequery` version from python/hypequery/pyproject.toml.
 * Read at build time by consumers; see `Registry` for why it is not committed.
 */
export function readPackageVersions(repoRoot: string): Record<string, string> {
  const packagesDir = path.join(repoRoot, 'packages');
  const versions: Record<string, string> = {};
  if (!fs.existsSync(packagesDir)) return versions;
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
  // The Python package, for `language: "python"` examples (PyPI name `hypequery`).
  const pyproject = path.join(repoRoot, 'python', 'hypequery', 'pyproject.toml');
  if (fs.existsSync(pyproject)) {
    const match = /^version\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(pyproject, 'utf8'));
    if (match) versions.hypequery = match[1];
  }
  return versions;
}

/** Stable text so the committed file diffs cleanly. */
export function renderRegistry(registry: Registry): string {
  return `${JSON.stringify(registry, null, 2)}\n`;
}
