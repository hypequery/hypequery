import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectFacets,
  entriesForFunction,
  entriesForLeadPage,
  entryHref,
  examples,
  filterEntries,
  getEntry,
  readmeBody,
  registryEntries,
} from './examples';
import { entryMarkdown } from './examples-markdown';

test('registry loads with at least the first two examples', () => {
  assert.ok(registryEntries.length >= 2);
  const dashboard = getEntry('example', 'nextjs-dashboard');
  assert.ok(dashboard);
  assert.equal(entryHref(dashboard), '/examples/nextjs-dashboard');
  assert.equal(dashboard.keyFile.path, dashboard.manifest.keyFile);
});

test('lead-page and function-page lookups follow manifest tags', () => {
  assert.ok(entriesForLeadPage('/clickhouse-nextjs').some((e) => e.manifest.slug === 'nextjs-dashboard'));
  assert.equal(entriesForLeadPage('/no-such-page').length, 0);
  assert.ok(entriesForFunction('count').length >= 1);
  assert.ok(entriesForFunction('COUNT').length >= 1, 'function slugs match case-insensitively');
});

test('facets and filters work together', () => {
  const facets = collectFacets(examples);
  assert.ok(facets.stack.includes('nextjs'));
  const onlyNext = filterEntries(examples, { stack: 'nextjs' });
  assert.ok(onlyNext.every((e) => e.manifest.stack.includes('nextjs')));
  assert.equal(filterEntries(examples, { language: 'python' }).length, 0);
});

test('readmeBody drops the H1 and the repeated outcome, and rewrites relative links', () => {
  const dashboard = getEntry('example', 'nextjs-dashboard')!;
  const body = readmeBody(dashboard);
  assert.ok(!body.startsWith('# '));
  assert.ok(!body.startsWith(dashboard.manifest.outcome));
  assert.ok(body.includes('](/examples/materialized-view-rollups)'), 'relative sibling link becomes a site path');
  assert.ok(body.includes(`](${dashboard.screenshot})`), 'screenshot path points at public/');
});

test('the Markdown twin carries breadcrumb, llms.txt link, run block, key file and related links', () => {
  const md = entryMarkdown(getEntry('example', 'materialized-view-rollups')!);
  assert.match(md, /^\[hypequery\]\(https:\/\/hypequery\.com\/\) › \[Examples\]/);
  assert.ok(md.includes('Index for agents: https://hypequery.com/llms.txt'));
  assert.ok(md.includes('npx hypequery create materialized-view-rollups -y'));
  assert.ok(md.includes('## Key file: src/datasets.ts'));
  assert.ok(md.trimEnd().split('\n').slice(-6).join('\n').includes('## Related') || md.includes('## Related'));
  assert.ok(md.endsWith('\n'));
});
