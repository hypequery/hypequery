import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Manifest, type Manifest as ManifestType, type ManifestKind } from './manifest.js';

/** Registry roots, relative to the repo root, and the manifest kind each must hold. */
export const REGISTRY_ROOTS: ReadonlyArray<{ dir: string; kind: ManifestKind; file: string }> = [
  { dir: 'examples', kind: 'example', file: 'example.json' },
  { dir: 'recipes', kind: 'recipe', file: 'recipe.json' },
];

export interface ValidationIssue {
  /** Repo-relative path of the offending file (manifest or folder). */
  file: string;
  message: string;
}

export interface LoadedManifest {
  /** Repo-relative folder, e.g. `examples/nextjs-dashboard`. */
  dir: string;
  manifest: ManifestType;
}

export interface ValidationResult {
  manifests: LoadedManifest[];
  issues: ValidationIssue[];
}

/** Folders starting with `_` (seed, templates, fixtures) are not registry entries. */
export function isRegistryEntry(folderName: string): boolean {
  return !folderName.startsWith('_') && !folderName.startsWith('.');
}

function listEntryDirs(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isRegistryEntry(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function formatZodIssue(issue: z.core.$ZodIssue): string {
  const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
  return `${where}: ${issue.message}`;
}

function fileExists(folder: string, relative: string): boolean {
  const resolved = path.resolve(folder, relative);
  if (!resolved.startsWith(path.resolve(folder) + path.sep)) return false;
  return fs.existsSync(resolved) && fs.statSync(resolved).isFile();
}

/**
 * Validate every manifest under the registry roots of `repoRoot`.
 *
 * Checks, per entry: the manifest parses against its Zod schema, `kind`
 * matches the root it lives in, `slug` matches the folder name, referenced
 * files and `README.md` exist, and `related` slugs resolve. Across entries:
 * slugs are unique.
 */
export function validateRegistry(repoRoot: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const manifests: LoadedManifest[] = [];
  const slugOwners = new Map<string, string>();

  for (const root of REGISTRY_ROOTS) {
    const rootAbs = path.join(repoRoot, root.dir);
    for (const folderName of listEntryDirs(rootAbs)) {
      const dirRel = path.posix.join(root.dir, folderName);
      const dirAbs = path.join(rootAbs, folderName);
      const manifestRel = path.posix.join(dirRel, root.file);
      const manifestAbs = path.join(dirAbs, root.file);

      if (!fs.existsSync(manifestAbs)) {
        issues.push({ file: dirRel, message: `missing ${root.file} (every folder under ${root.dir}/ needs one; prefix with "_" to exclude)` });
        continue;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(manifestAbs, 'utf8'));
      } catch (error) {
        issues.push({ file: manifestRel, message: `invalid JSON: ${(error as Error).message}` });
        continue;
      }

      const parsed = Manifest.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          issues.push({ file: manifestRel, message: formatZodIssue(issue) });
        }
        continue;
      }

      const manifest = parsed.data;
      if (manifest.kind !== root.kind) {
        issues.push({ file: manifestRel, message: `kind must be "${root.kind}" for entries under ${root.dir}/ (got "${manifest.kind}")` });
      }
      if (manifest.slug !== folderName) {
        issues.push({ file: manifestRel, message: `slug "${manifest.slug}" does not match folder name "${folderName}"` });
      }

      const owner = slugOwners.get(manifest.slug);
      if (owner) {
        issues.push({ file: manifestRel, message: `slug "${manifest.slug}" is already used by ${owner}` });
      } else {
        slugOwners.set(manifest.slug, dirRel);
      }

      if (!fileExists(dirAbs, 'README.md')) {
        issues.push({ file: dirRel, message: 'missing README.md (it drives the page body and the Markdown twin)' });
      }

      const fileRefs: Array<[string, string]> = [['keyFile', manifest.keyFile]];
      if (manifest.kind === 'recipe') {
        fileRefs.push(
          ['datasetFile', manifest.datasetFile],
          ['expectedSqlFile', manifest.expectedSqlFile],
          ['outputFile', manifest.outputFile],
        );
      }
      for (const [field, relative] of fileRefs) {
        if (!fileExists(dirAbs, relative)) {
          issues.push({ file: manifestRel, message: `${field} "${relative}" does not exist in ${dirRel}/` });
        }
      }

      manifests.push({ dir: dirRel, manifest });
    }
  }

  for (const { dir, manifest } of manifests) {
    for (const related of manifest.related) {
      if (related === manifest.slug) {
        issues.push({ file: dir, message: `related must not include the entry's own slug "${related}"` });
      } else if (!slugOwners.has(related)) {
        issues.push({ file: dir, message: `related slug "${related}" does not match any example or recipe` });
      }
    }
  }

  issues.sort((a, b) => a.file.localeCompare(b.file) || a.message.localeCompare(b.message));
  return { manifests, issues };
}

/** Human-readable report, one issue per line, grouped by file. */
export function formatIssues(issues: ValidationIssue[]): string {
  const byFile = new Map<string, string[]>();
  for (const issue of issues) {
    const list = byFile.get(issue.file) ?? [];
    list.push(issue.message);
    byFile.set(issue.file, list);
  }
  const lines: string[] = [];
  for (const [file, messages] of byFile) {
    lines.push(file);
    for (const message of messages) lines.push(`  - ${message}`);
  }
  return lines.join('\n');
}
