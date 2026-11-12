import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ensureGitignore, removeGeneratedFiles } from './publish-templates.mjs';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'templates-test-'));
}

test('removeGeneratedFiles strips install and test output at any depth', () => {
  const dir = tmp();
  for (const d of ['node_modules/x', '.venv/bin', 'analytics/__pycache__', 'tests/__pycache__', '.pytest_cache/v', 'src']) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'src/app.py'), '');
  fs.writeFileSync(path.join(dir, 'analytics/__pycache__/x.pyc'), '');
  removeGeneratedFiles(dir);
  const left = fs.readdirSync(dir, { recursive: true }).sort();
  assert.deepEqual(left, ['analytics', 'src', 'src/app.py', 'tests']);
});

test('ensureGitignore adds missing standard lines and keeps the example\'s own', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'db.sqlite3\n');
  ensureGitignore(dir);
  const lines = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').trim().split('\n');
  assert.equal(lines[0], 'db.sqlite3');
  for (const line of ['node_modules/', '.venv/', '__pycache__/', '.pytest_cache/', '.env']) assert.ok(lines.includes(line), line);
  ensureGitignore(dir);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').trim().split('\n').length, lines.length, 'idempotent');

  const fresh = tmp();
  ensureGitignore(fresh);
  assert.ok(fs.readFileSync(path.join(fresh, '.gitignore'), 'utf8').includes('__pycache__/'));
});
