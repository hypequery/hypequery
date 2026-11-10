import { createAnalyticsHooks } from '@hypequery/react';
import type { AnalyticsApi } from '@/analytics/api';
import manifest from '@/analytics/hypequery-manifest.json';

// `import type` is erased at build time, so the server module (and the
// ClickHouse client it constructs) never reaches the browser bundle. Only the
// generated route manifest does.
export const { useDataset } = createAnalyticsHooks<AnalyticsApi>({
  baseUrl: '/api/analytics',
  manifest,
});
