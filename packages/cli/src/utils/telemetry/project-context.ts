import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export type ReadLocalFile = (file: string) => string | undefined;
export interface ProjectContext {
  readonly directory?: string;
  readonly rootDirectory?: string;
  readonly package?: Record<string, unknown>;
  readonly rootPackage?: Record<string, unknown>;
  readonly remote?: string;
}

/** Bounded regular-file reads only; local inspection never shells out or loads user code. */
export function readTelemetryFile(file: string): string | undefined {
  try {
    const info = statSync(file);
    if (!info.isFile() || info.size > 64 * 1024) return undefined;
    return readFileSync(file, 'utf8');
  } catch { return undefined; }
}

export function readPackage(file: string, read: ReadLocalFile): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(read(file) ?? 'null');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

export function remoteFromGitConfig(config: string | undefined): string | undefined {
  let remote = false;
  let origin = false;
  let fallback: string | undefined;
  for (const line of (config ?? '').split(/\r?\n/)) {
    const section = line.trim().match(/^\[remote\s+"([^"]+)"\]$/);
    if (section) { remote = true; origin = section[1] === 'origin'; continue; }
    if (line.trim().startsWith('[')) { remote = false; continue; }
    const url = remote ? line.match(/^\s*url\s*=\s*(.*?)\s*$/i)?.[1] : undefined;
    if (url) {
      const unquoted = url.startsWith('"') && url.endsWith('"') ? url.slice(1, -1) : url;
      if (origin) return unquoted;
      fallback ??= unquoted;
    }
  }
  return fallback;
}

/** Finds the workspace root and linked-worktree git config within a small local I/O budget. */
export function inspectProject(
  cwd: string,
  read: ReadLocalFile = readTelemetryFile,
  budgetMs = 5,
): ProjectContext {
  const deadline = performance.now() + budgetMs;
  let context: ProjectContext = {};
  try {
    let directory = path.resolve(cwd);
    for (let depth = 0; depth < 24 && performance.now() < deadline; depth++) {
      const pkg = readPackage(path.join(directory, 'package.json'), read);
      if (!context.directory && pkg) context = { ...context, directory, package: pkg };
      if (pkg && (pkg.workspaces || read(path.join(directory, 'pnpm-workspace.yaml')) !== undefined)) {
        context = { ...context, rootDirectory: directory, rootPackage: pkg };
      }
      let gitDirectory = path.join(directory, '.git');
      const gitFile = read(gitDirectory)?.match(/^gitdir:\s*(.+?)\s*$/)?.[1];
      if (gitFile) gitDirectory = path.resolve(directory, gitFile);
      const common = read(path.join(gitDirectory, 'commondir'))?.trim();
      if (common) gitDirectory = path.resolve(gitDirectory, common);
      const gitConfig = read(path.join(gitDirectory, 'config'));
      if (gitConfig !== undefined) {
        context = { ...context, remote: remoteFromGitConfig(gitConfig),
          rootDirectory: context.rootDirectory ?? directory,
          rootPackage: context.rootPackage ?? pkg };
        break;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch { /* Optional metadata must never affect a command. */ }
  return context;
}
