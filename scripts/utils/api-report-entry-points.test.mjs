import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiReportEntryPoints, reportNameForSubpath } from './api-report-entry-points.mjs';

test('one report per exports subpath with a types condition', () => {
  const entries = apiReportEntryPoints({
    name: '@hypequery/datasets',
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './schemas': { types: './dist/schemas.d.ts' },
      './codegen': { types: './dist/codegen/index.d.ts' },
      './package.json': './package.json',
      './runtime/*': { types: './dist/runtime/*.d.ts' },
    },
  });
  assert.deepEqual(entries, [
    { subpath: './codegen', types: 'dist/codegen/index.d.ts', reportName: 'codegen' },
    { subpath: '.', types: 'dist/index.d.ts', reportName: 'index' },
    { subpath: './schemas', types: 'dist/schemas.d.ts', reportName: 'schemas' },
  ]);
});

test('falls back to the types field without exports', () => {
  assert.deepEqual(apiReportEntryPoints({ name: 'x', types: 'dist/index.d.ts' }), [
    { subpath: '.', types: 'dist/index.d.ts', reportName: 'index' },
  ]);
  assert.throws(() => apiReportEntryPoints({ name: 'x' }), /no types entry point/);
});

test('report names are file-safe', () => {
  assert.equal(reportNameForSubpath('./a/b'), 'a-b');
});
