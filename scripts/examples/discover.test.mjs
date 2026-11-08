import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discover } from './discover.mjs';
import { rewriteWorkspaceRanges } from './use-published.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'examples-discover-'));
  return root;
}

test('discover returns [] for a repo with no examples or recipes', () => {
  assert.deepEqual(discover(tmpRepo()), []);
});

test('discover skips _ and . folders and flags missing manifests', () => {
  const root = tmpRepo();
  for (const dir of ['examples/_seed', 'examples/.hidden', 'examples/nextjs-dashboard', 'examples/half-added', 'recipes/p95-latency']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'examples/nextjs-dashboard/example.json'), '{}');
  fs.writeFileSync(path.join(root, 'examples/nextjs-dashboard/package.json'), '{"name":"@hypequery-examples/nextjs-dashboard"}');
  fs.writeFileSync(path.join(root, 'recipes/p95-latency/recipe.json'), '{}');
  fs.writeFileSync(path.join(root, 'examples/_seed/package.json'), '{}');
  assert.deepEqual(discover(root), [
    { dir: 'examples/half-added', kind: 'example', slug: 'half-added', hasManifest: false, package: null },
    { dir: 'examples/nextjs-dashboard', kind: 'example', slug: 'nextjs-dashboard', hasManifest: true, package: '@hypequery-examples/nextjs-dashboard' },
    { dir: 'recipes/p95-latency', kind: 'recipe', slug: 'p95-latency', hasManifest: true, package: null },
  ]);
});

test('discover CLI prints compact JSON for GITHUB_OUTPUT', () => {
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, 'examples/a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'examples/a/example.json'), '{}');
  const out = execFileSync(process.execPath, [path.join(here, 'discover.mjs'), '--root', root], { encoding: 'utf8' });
  assert.equal(out, '[{"dir":"examples/a","kind":"example","slug":"a","hasManifest":true,"package":null}]\n');
  const empty = execFileSync(process.execPath, [path.join(here, 'discover.mjs'), '--root', tmpRepo()], { encoding: 'utf8' });
  assert.equal(empty, '[]\n');
});

test('rewriteWorkspaceRanges swaps only workspace ranges', () => {
  const pkg = {
    dependencies: { '@hypequery/clickhouse': 'workspace:*', react: '^19.0.0' },
    devDependencies: { '@hypequery/examples-schema': 'workspace:^', vitest: '^5.0.0' },
  };
  const changed = rewriteWorkspaceRanges(pkg, 'canary');
  assert.deepEqual(pkg.dependencies, { '@hypequery/clickhouse': 'canary', react: '^19.0.0' });
  assert.deepEqual(pkg.devDependencies, { '@hypequery/examples-schema': 'canary', vitest: '^5.0.0' });
  assert.equal(changed.length, 2);
  assert.deepEqual(rewriteWorkspaceRanges({ dependencies: { a: '1.0.0' } }), []);
});
