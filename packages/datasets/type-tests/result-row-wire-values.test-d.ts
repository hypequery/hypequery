/**
 * Result rows describe what a query actually returns. Dimensions pass through
 * ClickHouse JSON unnormalized: the built-in adapter quotes Int64 and wider
 * integers as strings, and Nullable columns yield null. Datasets declare
 * neither column types nor nullability, so numeric dimensions are
 * `number | string`, every dimension may be null, and so may `period`.
 * `InferDimensionType` keeps describing the declared value type.
 */

import {
  belongsTo,
  createDatasetClient,
  dataset,
  dimension,
  measure,
  type DatasetRow,
  type DatasetRowFor,
  type DimensionResultValue,
  type InferDimensionType,
  type MetricRow,
  type MetricRowFor,
} from '../src/index.js';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

const Users = dataset('users', {
  source: 'users',
  dimensions: {
    age: dimension.number(),
    plan: dimension.string(),
  },
});

const Events = dataset('events', {
  source: 'events',
  timeKey: 'created_at',
  dimensions: {
    userId: dimension.number({ column: 'user_id' }),
    country: dimension.string(),
    isPaid: dimension.boolean({ column: 'is_paid' }),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    eventCount: measure.count('user_id'),
  },
  relationships: {
    user: belongsTo(() => Users, { from: 'user_id', to: 'id' }),
  },
});

const eventCount = Events.metric('eventCount', { measure: 'eventCount' });
const analytics = createDatasetClient({ queryBuilder: {} as never });

// --- The wire-value type itself ---------------------------------------------------
type _NumberWire = Assert<Equal<DimensionResultValue<typeof Events.dimensions.userId>, number | string | null>>;
type _StringWire = Assert<Equal<DimensionResultValue<typeof Events.dimensions.country>, string | null>>;
type _BooleanWire = Assert<Equal<DimensionResultValue<typeof Events.dimensions.isPaid>, boolean | null>>;
type _TimestampWire = Assert<Equal<DimensionResultValue<typeof Events.dimensions.createdAt>, string | null>>;

// The declared value type is unchanged.
type _NumberDeclared = Assert<Equal<InferDimensionType<typeof Events.dimensions.userId>, number>>;
type _StringDeclared = Assert<Equal<InferDimensionType<typeof Events.dimensions.country>, string>>;

// --- createDatasetClient({ queryBuilder }) dataset rows ----------------------------
async function assertDatasetRows() {
  const result = await analytics.execute(Events, {
    dimensions: ['userId', 'country', 'isPaid', 'createdAt', 'user.age'] as const,
    measures: ['eventCount'] as const,
    by: 'month',
  });
  const row = result.data[0]!;

  type _UserId = Assert<Equal<typeof row.userId, number | string | null | undefined>>;
  type _Country = Assert<Equal<typeof row.country, string | null | undefined>>;
  type _IsPaid = Assert<Equal<typeof row.isPaid, boolean | null | undefined>>;
  type _CreatedAt = Assert<Equal<typeof row.createdAt, string | null | undefined>>;
  type _RelatedAge = Assert<Equal<typeof row['user.age'], number | string | null | undefined>>;
  type _Measure = Assert<Equal<typeof row.eventCount, string | null | undefined>>;
  type _Period = Assert<Equal<typeof row.period, string | null | undefined>>;

  // @ts-expect-error UInt64/Int64 dimensions arrive as strings, so the value is not always a number
  const userIdAsNumber: number | undefined = row.userId;
  void userIdAsNumber;
  // @ts-expect-error a Nullable column yields null
  const countryWithoutNull: string | undefined = row.country;
  void countryWithoutNull;
  // @ts-expect-error the bucket of a NULL time-key value is null
  const periodWithoutNull: string | undefined = row.period;
  void periodWithoutNull;
}

// --- createDatasetClient({ queryBuilder }) metric rows -----------------------------
async function assertMetricRows() {
  const result = await analytics.execute(eventCount, {
    dimensions: ['userId', 'isPaid'] as const,
    by: 'day',
  });
  const row = result.data[0]!;

  type _UserId = Assert<Equal<typeof row.userId, number | string | null | undefined>>;
  type _IsPaid = Assert<Equal<typeof row.isPaid, boolean | null | undefined>>;
  type _Value = Assert<Equal<typeof row.eventCount, string | null | undefined>>;
  type _Period = Assert<Equal<typeof row.period, string | null | undefined>>;

  // @ts-expect-error unselected dimensions are not exposed
  void row.country;
}

// --- Exported row types --------------------------------------------------------------
type ProjectedDatasetRow = DatasetRowFor<typeof Events, { dimensions: ['userId']; by: 'week' }>;
type _ProjectedUserId = Assert<Equal<ProjectedDatasetRow['userId'], number | string | null | undefined>>;
type _ProjectedPeriod = Assert<Equal<ProjectedDatasetRow['period'], string | null | undefined>>;

type ProjectedMetricRow = MetricRowFor<typeof Events, 'eventCount', { dimensions: ['userId'] }>;
type _ProjectedMetricUserId = Assert<Equal<ProjectedMetricRow['userId'], number | string | null | undefined>>;
type _ProjectedMetricKeys = Assert<Equal<keyof ProjectedMetricRow, 'userId' | 'eventCount'>>;

type BroadDatasetRow = DatasetRow<typeof Events>;
type _BroadUserId = Assert<Equal<BroadDatasetRow['userId'], number | string | null | undefined>>;
type _BroadRelatedPlan = Assert<Equal<BroadDatasetRow['user.plan'], string | null | undefined>>;
type _BroadPeriod = Assert<Equal<BroadDatasetRow['period'], string | null | undefined>>;

type BroadMetricRow = MetricRow<typeof Events, 'eventCount'>;
type _BroadMetricUserId = Assert<Equal<BroadMetricRow['userId'], number | string | null | undefined>>;
type _BroadMetricPeriod = Assert<Equal<BroadMetricRow['period'], string | null | undefined>>;

void assertDatasetRows;
void assertMetricRows;
