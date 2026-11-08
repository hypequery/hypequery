import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
};

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

export interface RangeRewrite {
  field: string;
  name: string;
  from: string;
  to: string;
}

/**
 * Examples depend on `@hypequery/*` with `workspace:*` so the monorepo tests
 * them against the current source. A scaffolded copy needs real versions:
 * the exact versions the registry recorded (`pins`), or a dist-tag.
 */
export function rewriteWorkspaceRanges(pkg: PackageJson, pins: Record<string, string>, fallback: string): RangeRewrite[] {
  const changes: RangeRewrite[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== 'string' || !range.startsWith('workspace:')) continue;
      const to = pins[name] ?? fallback;
      deps[name] = to;
      changes.push({ field, name, from: range, to });
    }
  }
  return changes;
}

/** Folders that never belong in a scaffold. */
const SKIP = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);

export async function copyExampleTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  await cp(from, to, {
    recursive: true,
    filter: (source) => !SKIP.has(path.basename(source)) && !path.basename(source).endsWith('.tsbuildinfo'),
  });
}

export async function isEmptyDirectory(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return true;
  return (await readdir(dir)).length === 0;
}

/**
 * READMEs are written for the monorepo. In a scaffold the seed lives in
 * `./seed`, and sibling examples live on the website.
 */
export function rewriteReadmeForScaffold(readme: string, siteUrl = 'https://hypequery.com'): string {
  return readme
    .replace(/\.\.\/examples\/_seed\/docker-compose\.yml/g, 'seed/docker-compose.yml')
    .replace(/&& pnpm seed/g, '&& (cd seed && pnpm install && pnpm seed)')
    .replace(/\]\(\.\.\/\.\.\/recipes\/([a-z0-9-]+)\)/g, `](${siteUrl}/recipes/$1)`)
    .replace(/\]\(\.\.\/\.\.\/examples\/([a-z0-9-]+)\)/g, `](${siteUrl}/examples/$1)`)
    .replace(/\]\(\.\.\/([a-z0-9-]+)\)/g, (match, slug: string) => (slug === '_seed' ? match : `](${siteUrl}/examples/${slug})`));
}

export async function rewritePackageJson(dir: string, pins: Record<string, string>, fallback: string): Promise<RangeRewrite[]> {
  const file = path.join(dir, 'package.json');
  const pkg = JSON.parse(await readFile(file, 'utf8')) as PackageJson;
  const changes = rewriteWorkspaceRanges(pkg, pins, fallback);
  await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
  return changes;
}

/**
 * Python examples pin the monorepo's `hypequery` through `[tool.uv.sources]`;
 * a scaffold must resolve the published PyPI release instead.
 */
export function stripUvSources(pyproject: string): { text: string; changed: boolean } {
  const pattern = /\n\[tool\.uv\.sources\]\n(?:[^\n]*\n)*?(?=\n\[|$)/;
  if (!pattern.test(pyproject)) return { text: pyproject, changed: false };
  return { text: pyproject.replace(pattern, '\n'), changed: true };
}

export async function rewritePyproject(dir: string): Promise<boolean> {
  const file = path.join(dir, 'pyproject.toml');
  if (!existsSync(file)) return false;
  const result = stripUvSources(await readFile(file, 'utf8'));
  if (result.changed) await writeFile(file, result.text);
  return result.changed;
}

export async function rewriteReadme(dir: string): Promise<void> {
  const file = path.join(dir, 'README.md');
  if (!existsSync(file)) return;
  await writeFile(file, rewriteReadmeForScaffold(await readFile(file, 'utf8')));
}

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

/** From the running package manager's user agent (`npx`, `pnpm dlx`, ...), defaulting to pnpm. */
export function detectPackageManager(userAgent = process.env.npm_config_user_agent ?? ''): PackageManager {
  if (userAgent.startsWith('pnpm')) return 'pnpm';
  if (userAgent.startsWith('yarn')) return 'yarn';
  if (userAgent.startsWith('bun')) return 'bun';
  if (userAgent.startsWith('npm')) return 'npm';
  return 'pnpm';
}

export interface NextBlockInput {
  slug: string;
  dir: string;
  packageManager: PackageManager;
  installed: boolean;
  hasSeed: boolean;
  run: { install: string; dev: string; test: string };
  url: string;
}

const PM_RUN: Record<PackageManager, string> = { pnpm: 'pnpm', npm: 'npm run', yarn: 'yarn', bun: 'bun run' };
const PM_INSTALL: Record<PackageManager, string> = { pnpm: 'pnpm install', npm: 'npm install', yarn: 'yarn', bun: 'bun install' };

function swapManager(command: string, manager: PackageManager): string {
  // Commands that are not pnpm's (e.g. `uv sync`) are printed as written.
  if (manager === 'pnpm' || !command.startsWith('pnpm')) return command;
  return command
    .replace(/^pnpm install$/, PM_INSTALL[manager])
    .replace(/^pnpm (\S+)$/, `${PM_RUN[manager]} $1`);
}

/** The block every `create` run ends with, so an agent or a person knows the next command. */
export function renderNextBlock(input: NextBlockInput): string {
  const lines = ['', 'Next:', `  cd ${input.dir}`];
  if (input.hasSeed) {
    lines.push(
      '  docker compose -f seed/docker-compose.yml up -d --wait     # ClickHouse 25.8 with the shared seed schema',
      `  (cd seed && ${PM_INSTALL[input.packageManager]} && ${PM_RUN[input.packageManager]} seed)   # loads the 1M-event dataset (about 10s)`,
      '  # or point CLICKHOUSE_URL / CLICKHOUSE_DATABASE at your own ClickHouse and skip the seed',
    );
  }
  // A Node install only covers a pnpm/npm `install` step; other toolchains
  // (uv for Python) always need their own step printed.
  if (!input.installed || !input.run.install.startsWith('pnpm')) lines.push(`  ${swapManager(input.run.install, input.packageManager)}`);
  lines.push(`  ${swapManager(input.run.dev, input.packageManager)}`, '', `Docs: ${input.url}`, `Test: ${swapManager(input.run.test, input.packageManager)}`, '');
  return lines.join('\n');
}
