// Hooks typed by a client contract exported from a TypeScript serve API
// (`hypequery export:client-contract`, then `hypequery generate:client`). The
// CLI's round-trip test regenerates serve-client-contract.generated.ts from
// packages/cli/type-tests/fixtures/serve-client-api.ts and fails on drift.
import { createAnalyticsHooks } from '../src/index.js';
import { clientManifest, type ClientApi, type ClientResponseMeta } from './serve-client-contract.generated.js';
import type { Expect, Equal } from '@type-challenges/utils';

const hooks = createAnalyticsHooks<ClientApi>({ baseUrl: 'https://api.example.com', manifest: clientManifest });

const selected = hooks.useDataset('orders', { dimensions: ['country', 'amount'], measures: ['revenue', 'averageOrder'], by: 'month' });
type Selected = NonNullable<typeof selected.data>['data'][number];
export type _Keys = Expect<Equal<keyof Selected, 'country' | 'amount' | 'revenue' | 'averageOrder' | 'period'>>;
// Local fields have unknown nullability; numbers may arrive as decimal strings.
export type _Country = Expect<Equal<Selected['country'], string | null>>;
export type _Amount = Expect<Equal<Selected['amount'], number | string | null>>;
export type _Revenue = Expect<Equal<Selected['revenue'], string | null>>;

const defaults = hooks.useDataset('orders', {});
export type _DefaultKeys = Expect<Equal<keyof NonNullable<typeof defaults.data>['data'][number], 'revenue' | 'orders' | 'latestCountry'>>;

const metric = hooks.useMetric('totalRevenue', { dimensions: ['paid'], includeMeta: true });
type Metric = NonNullable<typeof metric.data>;
export type _MetricKeys = Expect<Equal<keyof Metric['data'][number], 'paid' | 'totalRevenue'>>;
export type _MetricMeta = Expect<Equal<Metric['meta'], ClientResponseMeta>>;

// @ts-expect-error A filter-only timestamp is not groupable.
hooks.useDataset('orders', { dimensions: ['createdAt'] });
// @ts-expect-error Filters accept only their advertised operators.
hooks.useDataset('orders', { filters: [{ field: 'minimumAmount', operator: 'lt', value: 5 }] });
// @ts-expect-error HAVING excludes non-numeric aggregates.
hooks.useDataset('orders', { measures: ['latestCountry'], having: [{ measure: 'latestCountry', operator: 'eq', value: 1 }] });
// @ts-expect-error Metrics serve their one value.
hooks.useMetric('totalRevenue', { measures: ['revenue'] });

export const pinned: string = clientManifest['dataset:orders'].schemaHash;
