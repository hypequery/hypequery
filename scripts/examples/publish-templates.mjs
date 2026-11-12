#!/usr/bin/env node
/**
 * Mirror every registry example into its own GitHub template repository,
 * `hypequery/<slug>`, so it can be used with "Use this template" and found on
 * GitHub. The mirror is exactly what `hypequery create <slug> -y --no-install`
 * scaffolds: `@hypequery/*` pinned to the recorded npm versions, Python
 * examples resolving `hypequery` from PyPI, the shared seed in `./seed`.
 *
 *   node scripts/examples/publish-templates.mjs                  # export to .template-export/, push nothing
 *   node scripts/examples/publish-templates.mjs --only nextjs-dashboard
 *   node scripts/examples/publish-templates.mjs --verify         # also install + test each export (needs the seed running)
 *   node scripts/examples/publish-templates.mjs --publish        # verify, then push to repos that already exist
 *   node scripts/examples/publish-templates.mjs --publish --create  # also create missing repos (public templates)
 *
 * Needs `pnpm --filter @hypequery/cli build` first (it reuses the CLI's
 * scaffold helpers) and, for --publish, an authenticated `gh` with write access
 * to the hypequery org (GH_TOKEN in CI). The monorepo stays the source of
 * truth: each mirror's README says so, and a sync only commits when the export
 * changed.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORG = 'hypequery';
const SITE = 'https://hypequery.com';

function parseArgs(argv) {
  const args = { publish: false, create: false, verify: false, only: [], out: path.join(root, '.template-export') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--publish') args.publish = args.verify = true;
    else if (arg === '--verify') args.verify = true;
    else if (arg === '--create') args.create = true;
    else if (arg === '--only') args.only.push(...argv[++i].split(','));
    else if (arg === '--out') args.out = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (args.create && !args.publish) throw new Error('--create needs --publish');
  return args;
}

function run(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

async function loadScaffold() {
  const dist = path.join(root, 'packages/cli/dist/utils/examples');
  if (!fs.existsSync(path.join(dist, 'scaffold.js'))) {
    throw new Error('Build the CLI first: pnpm --filter @hypequery/cli build');
  }
  const scaffold = await import(pathToFileURL(path.join(dist, 'scaffold.js')).href);
  const { resolvePins } = await import(pathToFileURL(path.join(dist, 'npm-versions.js')).href);
  const schemaDist = path.join(root, 'packages/examples-schema/dist/registry.js');
  if (!fs.existsSync(schemaDist)) {
    throw new Error('Build the examples schema first: pnpm --filter @hypequery/examples-schema build');
  }
  const { readPackageVersions } = await import(pathToFileURL(schemaDist).href);
  return { ...scaffold, resolvePins, readPackageVersions };
}

function templateFooter(slug, sha) {
  return [
    '',
    '---',
    '',
    `This repository is generated from [\`examples/${slug}\`](https://github.com/${ORG}/hypequery/tree/main/examples/${slug}) in the hypequery monorepo`,
    `(synced from \`${sha.slice(0, 12)}\`). Open issues and pull requests there; changes made here are overwritten on the next sync.`,
    `Docs and the rest of the examples: ${SITE}/examples.`,
    '',
  ].join('\n');
}

/**
 * The committed tree at `sha`, not the working copy: a mirror must never pick
 * up `.venv/`, local databases or uncommitted edits, and its footer names `sha`.
 */
function checkoutCommitted(sha, dirs) {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'template-src-'));
  const tar = execFileSync('git', ['archive', '--format=tar', sha, '--', ...dirs], { cwd: root, maxBuffer: 512 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', tree], { input: tar });
  return tree;
}

export async function exportExample(entry, { out, pins, tag, sha, scaffold }) {
  const target = path.join(out, entry.manifest.slug);
  fs.rmSync(target, { recursive: true, force: true });
  const tree = checkoutCommitted(sha, [entry.dir, 'examples/_seed']);
  try {
    await scaffold.copyExampleTree(path.join(tree, entry.dir), target);
    await scaffold.copyExampleTree(path.join(tree, 'examples/_seed'), path.join(target, 'seed'));
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
  }
  await scaffold.rewritePackageJson(target, pins, tag);
  await scaffold.rewritePackageJson(path.join(target, 'seed'), pins, tag);
  await scaffold.rewritePyproject(target);
  await scaffold.rewriteReadme(target);
  fs.appendFileSync(path.join(target, 'README.md'), templateFooter(entry.manifest.slug, sha));
  ensureGitignore(target);
  return target;
}

/** Generated by installs and test runs; never part of a template. */
const GENERATED_DIRS = ['node_modules', '.venv', 'dist', '.next', '__pycache__', '.pytest_cache', '.ruff_cache', '.mypy_cache'];
const IGNORE_LINES = ['node_modules/', 'dist/', '.next/', '.venv/', '__pycache__/', '.pytest_cache/', '.env'];

/** Add the standard ignore lines an export is missing; its own lines stay. */
export function ensureGitignore(dir) {
  const file = path.join(dir, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = new Set(existing.split('\n').map((line) => line.trim()));
  const missing = IGNORE_LINES.filter((line) => !lines.has(line) && !lines.has(line.replace(/\/$/, '')));
  if (missing.length === 0) return;
  fs.writeFileSync(file, `${existing.trimEnd()}${existing.trim() ? '\n' : ''}${missing.join('\n')}\n`);
}

/** Remove install and test output anywhere under `dir`, at any depth. */
export function removeGeneratedFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (GENERATED_DIRS.includes(entry.name)) fs.rmSync(full, { recursive: true, force: true });
    else removeGeneratedFiles(full);
  }
}

/**
 * Install and test the export exactly as a "Use this template" user would:
 * published packages only, outside the workspace. A template that fails here
 * is not pushed, so a mirror never goes red ahead of a release.
 */
function verifyExport(dir) {
  const opts = { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } };
  // Install and test inside one try: a failed install can already have
  // written .venv or node_modules, and those must not reach the mirror either.
  try {
    if (fs.existsSync(path.join(dir, 'pyproject.toml'))) {
      run('uv', ['sync'], opts);
    } else {
      run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], opts);
    }
    run('pnpm', ['test'], opts);
  } finally {
    removeGeneratedFiles(dir);
  }
}

function repoExists(slug) {
  try {
    run('gh', ['repo', 'view', `${ORG}/${slug}`, '--json', 'name']);
    return true;
  } catch {
    return false;
  }
}

function createRepo(entry) {
  const { slug, outcome, keywords = [], stack = [] } = entry.manifest;
  run('gh', ['repo', 'create', `${ORG}/${slug}`, '--public', '--description', outcome.slice(0, 340), '--homepage', `${SITE}/examples/${slug}`]);
  run('gh', ['api', '-X', 'PATCH', `repos/${ORG}/${slug}`, '-F', 'is_template=true', '-F', 'has_wiki=false', '-F', 'has_projects=false']);
  const topics = [...new Set(['clickhouse', 'hypequery', 'analytics', 'example', ...stack, ...keywords.flatMap((k) => k.split(' '))])]
    .map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
    .filter((t) => t && t.length <= 50)
    .slice(0, 20);
  run('gh', ['api', '-X', 'PUT', `repos/${ORG}/${slug}/topics`, '--input', '-'], { input: JSON.stringify({ names: topics }) });
}

function syncRepo(slug, exportDir, sha) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `template-${slug}-`));
  try {
    run('gh', ['repo', 'clone', `${ORG}/${slug}`, work, '--', '--depth', '1']);
    for (const name of fs.readdirSync(work)) {
      if (name !== '.git') fs.rmSync(path.join(work, name), { recursive: true, force: true });
    }
    fs.cpSync(exportDir, work, { recursive: true });
    run('git', ['add', '-A'], { cwd: work });
    if (!run('git', ['status', '--porcelain'], { cwd: work })) return 'unchanged';
    run('git', ['-c', 'user.name=hypequery-bot', '-c', 'user.email=bot@hypequery.com', 'commit', '-m', `Sync from ${ORG}/hypequery@${sha.slice(0, 12)}`], { cwd: work });
    run('git', ['push', 'origin', 'HEAD:main'], { cwd: work });
    return 'pushed';
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'website-next/src/data/examples-registry.json'), 'utf8'));
  const entries = registry.entries.filter((e) => e.manifest.kind === 'example' && (args.only.length === 0 || args.only.includes(e.manifest.slug)));
  if (entries.length === 0) throw new Error('No matching examples in the registry.');
  const scaffold = await loadScaffold();
  // Versions come from the checkout, not the committed registry (see Registry in examples-schema).
  const packageVersions = scaffold.readPackageVersions(root);
  const { pins, unpublished } = await scaffold.resolvePins(Object.keys(packageVersions).filter((name) => name.startsWith('@hypequery/')), packageVersions);
  if (unpublished.length > 0) console.warn(`Not on npm yet, using @latest: ${unpublished.join(', ')}`);
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: root });
  const failed = [];

  for (const entry of entries) {
    const { slug } = entry.manifest;
    const dir = await exportExample(entry, { out: args.out, pins, tag: 'latest', sha, scaffold });
    if (args.verify) {
      try {
        verifyExport(dir);
      } catch (error) {
        failed.push(slug);
        console.error(`FAILED ${slug}: install or test failed against published packages\n${error.stdout ?? ''}${error.stderr ?? ''}`.trim());
        continue;
      }
    }
    if (!args.publish) {
      console.log(`${args.verify ? 'verified' : 'exported'} ${slug} -> ${dir}`);
      continue;
    }
    if (!repoExists(slug)) {
      if (!args.create) {
        console.log(`skipped ${slug}: ${ORG}/${slug} does not exist (pass --create)`);
        continue;
      }
      createRepo(entry);
      console.log(`created ${ORG}/${slug}`);
    }
    console.log(`${syncRepo(slug, dir, sha)} ${ORG}/${slug}`);
  }
  if (failed.length > 0) {
    throw new Error(`${failed.length} template(s) failed verification and were not pushed: ${failed.join(', ')}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
