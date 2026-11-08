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
  /** README.md with the leading H1 kept; the site decides what to strip. */
  readme: string;
  keyFile: { path: string; language: string; source: string };
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
    const entry: RegistryEntry = {
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
      const sitePath = `/${manifest.kind === 'example' ? 'examples' : 'recipes'}/${manifest.slug}/screenshot.png`;
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

/** Stable text so the committed file diffs cleanly. */
export function renderRegistry(registry: Registry): string {
  return `${JSON.stringify(registry, null, 2)}\n`;
}
