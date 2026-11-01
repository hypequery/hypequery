import { ClientSchemaChangedError, createAnalyticsHooks, createHypequeryClient, HttpError, type QueryOutputForInput } from '../src/index.js';
import { clientManifest, type ClientApi, type ClientResponseMeta } from './client-contract.generated.js';
import type { Expect, Equal } from '@type-challenges/utils';

const hooks = createAnalyticsHooks<ClientApi>({ baseUrl: 'https://api.example.com', manifest: clientManifest });
const selected = hooks.useDataset('orders', { dimensions: ['country', 'amount', 'customer.tier'], measures: ['revenue'], by: 'day' });
type Selected = NonNullable<typeof selected.data>['data'][number];
export type _Country = Expect<Equal<Selected['country'], string>>;
export type _Amount = Expect<Equal<Selected['amount'], number | string | null>>;
export type _Related = Expect<Equal<Selected['customer.tier'], string | null>>;
export type _Measure = Expect<Equal<Selected['revenue'], string | null>>;
export type _Period = Expect<Equal<Selected['period'], string | null>>;
// @ts-expect-error Unselected measures stay absent.
selected.data?.data[0]?.orderCount;
// @ts-expect-error Nongroupable dimensions stay absent.
selected.data?.data[0]?.['customer.active'];

const defaults = hooks.useDataset('orders', {});
type Defaults = NonNullable<typeof defaults.data>['data'][number];
export type _DefaultKeys = Expect<Equal<keyof Defaults, 'revenue' | 'orderCount' | 'latestLabel'>>;
export type _DefaultValue = Expect<Equal<Defaults['revenue'], string | null>>;
const dimensionsOnly = hooks.useDataset('orders', { dimensions: ['country'], measures: [] });
export type _NoMeasures = Expect<Equal<keyof NonNullable<typeof dimensionsOnly.data>['data'][number], 'country'>>;
const metric = hooks.useMetric('ordersRevenue', { dimensions: ['customer.tier'] });
type Metric = NonNullable<typeof metric.data>['data'][number];
export type _MetricKeys = Expect<Equal<keyof Metric, 'revenue' | 'customer.tier'>>;
export type _MetricAlias = Expect<Equal<Metric['revenue'], string | null>>;
const infinite = hooks.useInfiniteDataset('orders', { dimensions: ['amount'], measures: ['averageRevenue'], limit: 10 });
type Infinite = NonNullable<typeof infinite.data>['pages'][number]['data'][number];
export type _InfiniteKeys = Expect<Equal<keyof Infinite, 'amount' | 'averageRevenue'>>;
export type _InfiniteNumber = Expect<Equal<Infinite['amount'], number | string | null>>;

// includeMeta: true guarantees metadata; otherwise it stays optional.
const withMeta = hooks.useDataset('orders', { measures: ['revenue'], includeMeta: true });
export type _RequestedMeta = Expect<Equal<NonNullable<typeof withMeta.data>['meta'], ClientResponseMeta>>;
export type _RequestedMetaRows = Expect<Equal<keyof NonNullable<typeof withMeta.data>['data'][number], 'revenue'>>;
const withoutMeta = hooks.useDataset('orders', { measures: ['revenue'] });
export type _OptionalMeta = Expect<Equal<NonNullable<typeof withoutMeta.data>['meta'], ClientResponseMeta | null | undefined>>;
const metricMeta = hooks.useMetric('ordersRevenue', { includeMeta: true });
export type _MetricMeta = Expect<Equal<NonNullable<typeof metricMeta.data>['meta']['pagination']['hasMore'], boolean>>;
// Infinite queries always request metadata, so each page carries it.
export type _InfiniteMeta = Expect<Equal<NonNullable<typeof infinite.data>['pages'][number]['meta'], ClientResponseMeta>>;
const infiniteMetric = hooks.useInfiniteMetric('ordersRevenue', { limit: 5 });
export type _InfiniteMetricMeta = Expect<Equal<NonNullable<typeof infiniteMetric.data>['pages'][number]['meta'], ClientResponseMeta>>;

// select receives the projected response and decides the result type.
const selectedMeta = hooks.useDataset('orders', { measures: ['revenue'], includeMeta: true }, {
  select: (response) => {
    type _SelectInput = Expect<Equal<typeof response.meta, ClientResponseMeta>>;
    return { rows: response.data };
  },
});
export type _SelectedResult = Expect<Equal<keyof NonNullable<typeof selectedMeta.data>, 'rows'>>;
// @ts-expect-error a select result without meta has no meta to read
selectedMeta.data?.meta;
const selectedMetric = hooks.useMetric('ordersRevenue', { includeMeta: true }, { select: (response) => response.meta.rowCount });
export type _SelectedMetric = Expect<Equal<typeof selectedMetric.data, number | undefined>>;

// Union outputs keep each variant's fields when meta is narrowed.
type VariantMeta = { requestId: string };
type VariantApi = {
  report: {
    input: { includeMeta?: boolean };
    output: { kind: 'ok'; value: number; meta?: VariantMeta } | { kind: 'empty'; reason: string; meta?: VariantMeta };
  };
};
type Variants = QueryOutputForInput<VariantApi, 'report', { includeMeta: true }>;
declare const variant: Variants;
if (variant.kind === 'ok') {
  const value: number = variant.value;
} else {
  const reason: string = variant.reason;
}
export type _VariantMeta = Expect<Equal<Variants['meta'], VariantMeta>>;

// Widened or optional selections cannot promise that every possible field is present.
declare const dynamic: ClientApi['dataset:orders']['input'];
const widened = hooks.useDataset('orders', dynamic);
type Widened = NonNullable<typeof widened.data>['data'][number];
export type _OptionalDimension = Expect<Equal<Widened['country'], string | undefined>>;
export type _OptionalMeasure = Expect<Equal<Widened['revenue'], string | null | undefined>>;
export type _OptionalPeriod = Expect<Equal<Widened['period'], string | null | undefined>>;
declare const varying: readonly ('country' | 'amount')[];
const array = hooks.useDataset('orders', { dimensions: varying, measures: [] });
declare const chosen: 'country' | 'customer.tier';
const union = hooks.useDataset('orders', { dimensions: [chosen, 'amount'], measures: [] });
type UnionRow = NonNullable<typeof union.data>['data'][number];
export type _UnionElementCountry = Expect<Equal<UnionRow['country'], string | undefined>>;
export type _UnionElementTier = Expect<Equal<UnionRow['customer.tier'], string | null | undefined>>;
export type _UnionElementCertain = Expect<Equal<UnionRow['amount'], number | string | null>>;
declare const alternatives: readonly ['country', 'amount'] | readonly ['amount'];
const either = hooks.useDataset('orders', { dimensions: alternatives, measures: [] });
type EitherRow = NonNullable<typeof either.data>['data'][number];
export type _AlternativeOptional = Expect<Equal<EitherRow['country'], string | undefined>>;
export type _AlternativeCertain = Expect<Equal<EitherRow['amount'], number | string | null>>;
declare const disjoint: readonly ['country'] | readonly ['customer.tier'];
const neither = hooks.useDataset('orders', { dimensions: disjoint, measures: [] });
type NeitherRow = NonNullable<typeof neither.data>['data'][number];
export type _DisjointCountry = Expect<Equal<NeitherRow['country'], string | undefined>>;
export type _DisjointTier = Expect<Equal<NeitherRow['customer.tier'], string | null | undefined>>;
export type _ArrayNotTuple = Expect<Equal<NonNullable<typeof array.data>['data'][number]['country'], string | undefined>>;

// Ordinary APIs without a semantic tag must keep their declared output (rather than never).
type Ordinary = { plain: { input: { region: string }; output: { data: { original: number }[]; trace: string } } };
export type _OrdinaryFallback = Expect<Equal<QueryOutputForInput<Ordinary, 'plain', { region: 'UK' }>, Ordinary['plain']['output']>>;
const ordinary = createAnalyticsHooks<Ordinary>({ baseUrl: '/api' });
const ordinaryResult = ordinary.useMetric('plain', { region: 'UK' });
const original: number | undefined = ordinaryResult.data?.data[0]?.original;
void original;

// Future tags must fall back conservatively rather than being interpreted as version one.
type Future = { endpoint: { input: {}; output: { data: { future: boolean }[] }; __hypequeryClientSemantic?: { version: 2; kind: 'metric'; metricName: 'wrong' } } };
export type _FutureFallback = Expect<Equal<QueryOutputForInput<Future, 'endpoint', {}>, Future['endpoint']['output']>>;
createHypequeryClient<ClientApi>({ baseUrl: '/api', manifest: clientManifest });
// @ts-expect-error Generator filter value constraints survive the hooks.
hooks.useDataset('orders', { filters: [{ field: 'amount', operator: 'eq', value: '1' }] });
// @ts-expect-error Metric has no measure-selection override.
hooks.useMetric('ordersRevenue', { measures: ['revenue'] });

// Stale generated clients get a typed error that existing HttpError handlers still catch.
const stale = new ClientSchemaChangedError('changed', {});
export type _StaleIsHttpError = Expect<Equal<typeof stale extends HttpError ? true : false, true>>;
export type _StaleStatus = Expect<Equal<typeof stale['status'], number>>;
