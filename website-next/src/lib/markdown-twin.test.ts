import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embeddedAnalyticsComparePages } from '@/data/embedded-analytics-compare';
import { twinFor } from './markdown-twin';

test('pages with a Markdown twin rewrite to /llms.mdx', () => {
  assert.equal(twinFor('/compare/hypequery-vs-cube'), '/llms.mdx/compare/hypequery-vs-cube');
  assert.equal(twinFor('/compare/hypequery-vs-cube.md'), '/llms.mdx/compare/hypequery-vs-cube');
  assert.equal(twinFor('/docs/quick-start.mdx'), '/llms.mdx/docs/quick-start');
  assert.equal(twinFor('/examples/nextjs-dashboard'), '/llms.mdx/examples/nextjs-dashboard');
});

test('hubs and llms.txt sub-indexes have no twin', () => {
  assert.equal(twinFor('/compare'), null);
  assert.equal(twinFor('/examples/llms.txt'), null);
});

test('static embedded analytics compare pages are served as HTML, not a missing twin', () => {
  const underCompare = embeddedAnalyticsComparePages.filter((page) => page.href.startsWith('/compare/'));
  assert.ok(underCompare.length > 0);
  for (const page of underCompare) {
    assert.equal(twinFor(page.href), null, page.href);
    assert.equal(twinFor(`${page.href}.md`), null, `${page.href}.md`);
  }
});
