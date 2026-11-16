import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embeddedAnalyticsComparePages } from '@/data/embedded-analytics-compare';
import { htmlPathFor, twinFor } from './markdown-twin';

test('pages with a content-source twin rewrite to /llms.mdx', () => {
  assert.equal(twinFor('/compare/hypequery-vs-cube'), '/llms.mdx/compare/hypequery-vs-cube');
  assert.equal(twinFor('/compare/hypequery-vs-cube.md'), '/llms.mdx/compare/hypequery-vs-cube');
  assert.equal(twinFor('/docs/quick-start.mdx'), '/llms.mdx/docs/quick-start');
  assert.equal(twinFor('/examples/nextjs-dashboard'), '/llms.mdx/examples/nextjs-dashboard');
});

test('hand-built pages and hubs rewrite to the HTML-converted twin', () => {
  assert.equal(twinFor('/'), '/llms.mdx/pages');
  assert.equal(twinFor('/index.md'), '/llms.mdx/pages');
  assert.equal(twinFor('/embedded-analytics'), '/llms.mdx/pages/embedded-analytics');
  assert.equal(twinFor('/embedded-analytics.md'), '/llms.mdx/pages/embedded-analytics');
  assert.equal(twinFor('/compare'), '/llms.mdx/pages/compare');
});

test('llms.txt sub-indexes and unknown pages have no twin', () => {
  assert.equal(twinFor('/examples/llms.txt'), null);
  assert.equal(twinFor('/clickhouse-express'), null);
  assert.equal(twinFor('/not-a-page.md'), null);
});

test('static embedded analytics compare pages use the HTML twin, not the compare-article route', () => {
  const underCompare = embeddedAnalyticsComparePages.filter((page) => page.href.startsWith('/compare/'));
  assert.ok(underCompare.length > 0);
  for (const page of underCompare) {
    assert.equal(twinFor(page.href), `/llms.mdx/pages${page.href}`, page.href);
    assert.equal(twinFor(`${page.href}.md`), `/llms.mdx/pages${page.href}`, `${page.href}.md`);
  }
});

test('htmlPathFor names the canonical HTML page of a twin request', () => {
  assert.equal(htmlPathFor('/docs/query-building/caching.md'), '/docs/query-building/caching');
  assert.equal(htmlPathFor('/docs/query-building/caching.mdx'), '/docs/query-building/caching');
  assert.equal(htmlPathFor('/index.md'), '/');
  assert.equal(htmlPathFor('/'), '/');
  // A twin negotiated at the page's own URL is its own canonical (no noindex in src/proxy.ts).
  assert.equal(htmlPathFor('/blog/clickhouse-cte-typescript'), '/blog/clickhouse-cte-typescript');
});
