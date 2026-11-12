import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { readPackageVersions } from './package-versions';

test('reads npm and PyPI versions from the monorepo checkout', () => {
  const versions = readPackageVersions(path.resolve(__dirname, '../../..'));
  assert.match(versions['@hypequery/clickhouse'], /^\d+\.\d+\.\d+/);
  assert.match(versions['@hypequery/cli'], /^\d+\.\d+\.\d+/);
  assert.match(versions.hypequery, /^\d+\.\d+\.\d+/, 'PyPI version from pyproject.toml');
  assert.ok(!('@hypequery/examples-schema' in versions), 'private packages are left out');
});

test('returns an empty map outside the monorepo', () => {
  assert.deepEqual(readPackageVersions('/nonexistent'), {});
});
