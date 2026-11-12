#!/usr/bin/env node
/**
 * Point an example at published hypequery packages instead of the workspace.
 *
 *   node scripts/examples/use-published.mjs examples/nextjs-dashboard [--tag latest]
 *
 * Examples depend on `@hypequery/*` with `workspace:*` so a PR tests the code
 * it changes. The nightly run rewrites those ranges to a dist-tag (default
 * `latest`) and installs with `--ignore-workspace`, which is what a user gets
 * from `npx @hypequery/cli create <slug>`. It reuses the CLI's own scaffold
 * rewrites, so the nightly run and `create` cannot drift apart; build the CLI
 * first (`pnpm --filter @hypequery/cli... build`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scaffoldPath = path.join(root, 'packages/cli/dist/utils/examples/scaffold.js');

const args = process.argv.slice(2);
const tagIndex = args.indexOf('--tag');
const tag = tagIndex === -1 ? 'latest' : args[tagIndex + 1];
const dir = args.find((arg, i) => !arg.startsWith('--') && (tagIndex === -1 || i !== tagIndex + 1));
if (!dir) {
  console.error('usage: use-published.mjs <example-dir> [--tag <dist-tag>]');
  process.exit(2);
}
if (!fs.existsSync(scaffoldPath)) {
  console.error('Build the CLI first: pnpm --filter @hypequery/cli... build');
  process.exit(1);
}

const { rewritePackageJson, rewritePyproject } = await import(pathToFileURL(scaffoldPath).href);
const target = path.resolve(dir);
// No recorded pins: every workspace range becomes the dist-tag.
const changed = await rewritePackageJson(target, {}, tag);
for (const c of changed) console.log(`${c.field}.${c.name}: ${c.from} -> ${c.to}`);
const pyChanged = await rewritePyproject(target);
if (pyChanged) console.log('pyproject.toml: removed [tool.uv.sources], hypequery resolves from PyPI');
if (changed.length === 0 && !pyChanged) console.log(`${dir}: no workspace ranges to rewrite`);
