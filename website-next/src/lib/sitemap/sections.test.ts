import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embeddedAnalyticsComparePages } from '@/data/embedded-analytics-compare';
import { marketingPages } from '@/data/marketing-pages';
import { maybeUpdatedFor } from '@/data/page-dates';
import { blogLastModified } from './dates';

test('no page is listed in both the pages and compare sitemaps', () => {
  const compare = new Set(embeddedAnalyticsComparePages.map((page) => page.href));
  assert.deepEqual(marketingPages.filter((href) => compare.has(href)), []);
  assert.equal(new Set(marketingPages).size, marketingPages.length);
});

test('every marketing page has a sitemap lastmod', () => {
  assert.deepEqual(marketingPages.filter((href) => !maybeUpdatedFor(href)), []);
});

test('a refreshed blog post reports its update date, not its publish date', () => {
  assert.equal(blogLastModified('2026-11-12', '2026-01-11')?.toISOString().slice(0, 10), '2026-11-12');
  assert.equal(blogLastModified(undefined, '2026-01-11')?.toISOString().slice(0, 10), '2026-01-11');
  assert.equal(blogLastModified('2025-12-01', '2026-01-11')?.toISOString().slice(0, 10), '2026-01-11');
});
