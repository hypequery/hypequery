#!/usr/bin/env node
/**
 * Point an example at published hypequery packages instead of the workspace.
 *
 *   node scripts/examples/use-published.mjs examples/nextjs-dashboard [--tag latest]
 *
 * Examples depend on `@hypequery/*` with `workspace:*` so a PR tests the code
 * it changes. The nightly run rewrites those ranges to a dist-tag (default
 * `latest`) and installs with `--ignore-workspace`, which is what a user gets
 * from `npx hypequery create <slug>`. Prints the rewritten dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

export function rewriteWorkspaceRanges(pkg, tag = 'latest') {
  const changed = [];
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range === 'string' && range.startsWith('workspace:')) {
        deps[name] = tag;
        changed.push({ field, name, from: range, to: tag });
      }
    }
  }
  return changed;
}

/**
 * Python examples pin the workspace copy of `hypequery` through
 * `[tool.uv.sources]`. Removing that table makes uv resolve the published
 * PyPI release instead. Returns true when something was removed.
 */
export function stripUvSources(pyproject) {
  const pattern = /\n\[tool\.uv\.sources\]\n(?:[^\n]*\n)*?(?=\n\[|$)/;
  if (!pattern.test(pyproject)) return { text: pyproject, changed: false };
  return { text: pyproject.replace(pattern, '\n'), changed: true };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const tagIndex = args.indexOf('--tag');
  const tag = tagIndex === -1 ? 'latest' : args[tagIndex + 1];
  const dir = args.find((arg, i) => !arg.startsWith('--') && (tagIndex === -1 || i !== tagIndex + 1));
  if (!dir) {
    console.error('usage: use-published.mjs <example-dir> [--tag <dist-tag>]');
    process.exit(2);
  }
  const file = path.join(path.resolve(dir), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const changed = rewriteWorkspaceRanges(pkg, tag);
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  for (const c of changed) console.log(`${c.field}.${c.name}: ${c.from} -> ${c.to}`);
  const pyproject = path.join(path.resolve(dir), 'pyproject.toml');
  let pyChanged = false;
  if (fs.existsSync(pyproject)) {
    const result = stripUvSources(fs.readFileSync(pyproject, 'utf8'));
    if (result.changed) {
      fs.writeFileSync(pyproject, result.text);
      pyChanged = true;
      console.log('pyproject.toml: removed [tool.uv.sources], hypequery resolves from PyPI');
    }
  }
  if (changed.length === 0 && !pyChanged) console.log(`${dir}: no workspace ranges to rewrite`);
}
