import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
  type DatasetQueryResult,
  type DatasetRowFor,
  type SemanticArrowStreamResult,
  type SemanticStreamMeta,
  type AnyDatasetInstance,
} from '../src/index.js';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    country: dimension.string(),
    status: dimension.string(),
    amount: dimension.number(),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
  },
});

const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
const analytics = createDatasetClient({ queryBuilder: {} as never });

async function assertDatasetStreamRows() {
  const query = { dimensions: ['country'], measures: ['revenue'] } as const;
  const result = await analytics.stream(Orders, query);
  const executed = await analytics.execute(Orders, query);

  // Batches carry exactly the rows execute() returns.
  type _SameRows = Assert<Equal<
    typeof result.data,
    ReadableStream<DatasetRowFor<typeof Orders, typeof query>[]>
  >>;
  type _MatchesExecute = Assert<Equal<
    typeof result.data extends ReadableStream<(infer R)[]> ? R : never,
    (typeof executed.data)[number]
  >>;
  type _Meta = Assert<Equal<typeof result.meta, SemanticStreamMeta>>;

  for await (const batch of result.data as unknown as AsyncIterable<DatasetRowFor<typeof Orders, typeof query>[]>) {
    const row = batch[0]!;
    type _Country = Assert<Equal<typeof row.country, string | null | undefined>>;
    type _Revenue = Assert<Equal<typeof row.revenue, string | null | undefined>>;
    // @ts-expect-error unselected dimensions are not exposed
    void row.status;
  }

  // @ts-expect-error unknown measures are rejected, as on execute()
  await analytics.stream(Orders, { measures: ['missing'] });
}

async function assertMetricStreamRows() {
  const result = await analytics.stream(totalRevenue, { dimensions: ['status'] as const });
  const reader = result.data.getReader();
  const { value } = await reader.read();
  const row = value![0]!;

  type _Status = Assert<Equal<typeof row.status, string | null | undefined>>;
  type _Value = Assert<Equal<typeof row.totalRevenue, string | null | undefined>>;
  // @ts-expect-error metric streams expose only the metric value
  void row.orderCount;
}

async function assertArrowStream() {
  const result = await analytics.streamArrow(Orders, { dimensions: ['country'], measures: ['revenue'] });
  type _Arrow = Assert<Equal<typeof result, SemanticArrowStreamResult>>;
  type _Bytes = Assert<Equal<typeof result.data, ReadableStream<Uint8Array>>>;

  await analytics.streamArrow(totalRevenue, { dimensions: ['status'] });
  // @ts-expect-error unknown dimensions are rejected
  await analytics.streamArrow(Orders, { dimensions: ['missing'] });
}

async function assertDynamicTargets(ds: AnyDatasetInstance) {
  // Untyped datasets keep string-keyed queries on both methods.
  await analytics.stream(ds, { dimensions: ['any_dimension'], measures: ['any_measure'] });
  await analytics.streamArrow(ds, { dimensions: ['any_dimension'] });
}

async function assertLegacyExplicitRow() {
  const result = await analytics.stream<DatasetQueryResult['data'][number]>(Orders, { measures: ['revenue'] });
  type _Legacy = Assert<Equal<typeof result.data, ReadableStream<Record<string, unknown>[]>>>;
}

void assertDatasetStreamRows;
void assertMetricStreamRows;
void assertArrowStream;
void assertLegacyExplicitRow;
void assertDynamicTargets;
