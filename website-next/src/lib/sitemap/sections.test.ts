import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embeddedAnalyticsComparePages } from '@/data/embedded-analytics-compare';
import { marketingPages } from '@/data/marketing-pages';

test('no page is listed in both the pages and compare sitemaps', () => {
  const compare = new Set(embeddedAnalyticsComparePages.map((page) => page.href));
  assert.deepEqual(marketingPages.filter((href) => compare.has(href)), []);
  assert.equal(new Set(marketingPages).size, marketingPages.length);
});
