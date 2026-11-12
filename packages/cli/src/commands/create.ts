import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';
import { logger } from '../utils/logger.js';
import { findIndexEntry, loadExamplesIndex, type LoadIndexOptions } from '../utils/examples/registry-index.js';
import { fetchSourceWithGit, type SourceFetcher } from '../utils/examples/fetch-source.js';
import { resolvePins } from '../utils/examples/npm-versions.js';
import {
  copyExampleTree,
  detectPackageManager,
  isEmptyDirectory,
  renderNextBlock,
  rewritePackageJson,
  rewritePyproject,
  rewriteReadme,
  type PackageManager,
} from '../utils/examples/scaffold.js';

export interface CreateOptions {
  /** Accept every default and never prompt. */
  yes?: boolean;
  /** Target directory (default: ./<slug>). */
  dir?: string;
  /** Run the package manager install after scaffolding (default true). */
  install?: boolean;
  /** Dist-tag used for `@hypequery/*` packages whose recorded version is not on npm. */
  tag?: string;
  /** Skip the shared seed copy. */
  seed?: boolean;
}

export interface CreateDependencies extends LoadIndexOptions {
  fetchSource?: SourceFetcher;
  /** Used for the npm version checks. */
  npmFetch?: typeof fetch;
  cwd?: string;
  packageManager?: PackageManager;
  runInstall?: (manager: PackageManager, cwd: string) => Promise<void>;
  write?: (line: string) => void;
  isTTY?: boolean;
}

const INSTALL_ARGS: Record<PackageManager, string[]> = {
  pnpm: ['install'],
  npm: ['install'],
  yarn: [],
  bun: ['install'],
};

async function defaultRunInstall(manager: PackageManager, cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(manager, INSTALL_ARGS[manager], { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${manager} install exited with code ${code}`))));
  });
}

/**
 * `hypequery create <slug> [-y]`: scaffold a registry example or recipe into
 * `./<slug>`, pinned to published package versions, with the shared seed in
 * `./<slug>/seed`. No account, no prompts with -y, non-zero exit on failure,
 * and it always ends with a `Next:` block.
 */
export async function createCommand(slug: string, options: CreateOptions = {}, dependencies: CreateDependencies = {}): Promise<void> {
  const write = dependencies.write ?? ((line: string) => console.log(line));
  const cwd = dependencies.cwd ?? process.cwd();
  const interactive = !options.yes && (dependencies.isTTY ?? process.stdin.isTTY ?? false);

  const index = await loadExamplesIndex(dependencies);
  const entry = findIndexEntry(index, slug);
  if (!entry) {
    const slugs = index.entries.filter((e) => e.kind !== 'guide').map((e) => e.slug);
    throw new Error(`Unknown example "${slug}". Available: ${slugs.join(', ')}. Run \`hypequery examples list\` for details.`);
  }
  if (entry.kind === 'guide') {
    throw new Error(`"${slug}" is a guide, not a scaffold. Read it at ${entry.url} (Markdown: ${entry.markdown}).`);
  }

  let targetDir = path.resolve(cwd, options.dir ?? slug);
  if (interactive) {
    const answer = await prompts({ type: 'text', name: 'dir', message: 'Directory', initial: path.relative(cwd, targetDir) || '.' });
    if (answer.dir === undefined) throw new Error('Cancelled.');
    targetDir = path.resolve(cwd, String(answer.dir));
  }
  if (!(await isEmptyDirectory(targetDir))) {
    throw new Error(`${path.relative(cwd, targetDir) || '.'} already exists and is not empty. Choose another directory with --dir.`);
  }

  const includeSeed = options.seed !== false;
  const dirs = includeSeed ? [entry.dir, 'examples/_seed'] : [entry.dir];
  logger.info(`Fetching ${entry.dir} from ${index.source.repository}@${index.source.ref}...`);
  const fetchSource = dependencies.fetchSource ?? fetchSourceWithGit;
  const source = await fetchSource({ repository: index.source.repository, ref: index.source.ref, dirs });
  try {
    await copyExampleTree(path.join(source.root, entry.dir), targetDir);
    if (includeSeed && existsSync(path.join(source.root, 'examples/_seed'))) {
      await copyExampleTree(path.join(source.root, 'examples/_seed'), path.join(targetDir, 'seed'));
    }
  } finally {
    await source.cleanup();
  }

  const tag = options.tag ?? 'latest';
  // packageVersions also records the PyPI `hypequery`; only npm packages are pinned here.
  const npmPackages = Object.keys(index.packageVersions).filter((name) => name.startsWith('@hypequery/'));
  const { pins, unpublished } = await resolvePins(npmPackages, index.packageVersions, dependencies.npmFetch);
  const changes = await rewritePackageJson(targetDir, pins, tag);
  if (includeSeed && existsSync(path.join(targetDir, 'seed', 'package.json'))) {
    await rewritePackageJson(path.join(targetDir, 'seed'), pins, tag);
  }
  await rewriteReadme(targetDir);
  if (await rewritePyproject(targetDir)) {
    logger.indent('pyproject.toml: hypequery now resolves from PyPI');
  }
  for (const change of changes) {
    logger.indent(`${change.name}: ${change.from} -> ${change.to}`);
  }
  if (unpublished.length > 0) {
    logger.warn(`Not on npm yet, using @${tag}: ${unpublished.join(', ')}`);
  }

  const manager = dependencies.packageManager ?? detectPackageManager();
  let shouldInstall = options.install !== false;
  if (interactive && shouldInstall) {
    const answer = await prompts({ type: 'confirm', name: 'install', message: `Run ${manager} install now?`, initial: true });
    shouldInstall = answer.install === true;
  }
  let installed = false;
  let installFailed = false;
  if (shouldInstall) {
    logger.info(`Installing dependencies with ${manager}...`);
    try {
      await (dependencies.runInstall ?? defaultRunInstall)(manager, targetDir);
      installed = true;
    } catch (error) {
      installFailed = true;
      logger.warn(`Install failed: ${error instanceof Error ? error.message : String(error)}. The project is in place; run the install from the Next block.`);
    }
  }

  logger.success(`Created ${path.relative(cwd, targetDir) || '.'} from ${entry.title}`);
  write(
    renderNextBlock({
      slug,
      dir: path.relative(cwd, targetDir) || '.',
      packageManager: manager,
      installed,
      hasSeed: includeSeed && existsSync(path.join(targetDir, 'seed')),
      run: entry.run ?? { install: 'pnpm install', dev: 'pnpm dev', test: 'pnpm test' },
      url: entry.url,
    }),
  );
  // The scaffold is usable, but a script that asked for an install must not
  // read a failed one as success.
  if (installFailed) process.exitCode = 1;
}
