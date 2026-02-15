import { defineModel, dataset } from '../semantic/index.js';
import type { InferDatasetResult, Model } from '../semantic/index.js';
import type { Equal, Expect } from '@type-challenges/utils';

// ---------------------------------------------------------------------------
// Test schema — DB-agnostic TypeScript types
// ---------------------------------------------------------------------------

type TestSchema = {
  orders: {
    id: number;
    amount: number;
    country: string;
    status: string;
    created_at: string;
    user_id: number;
  };
  customers: {
    id: number;
    name: string;
    tier: string;
    email: string;
  };
};

// ---------------------------------------------------------------------------
// defineModel: type-safe model creation
// ---------------------------------------------------------------------------

const CustomerModel = defineModel<TestSchema, 'customers'>()({
  table: 'customers',
  label: 'Customers',
  dimensions: {
    name: { column: 'name', type: 'string', label: 'Name' },
    tier: { column: 'tier', type: 'string', label: 'Tier' },
  },
  measures: {
    customerCount: { column: 'id', type: 'count', label: 'Customer Count' },
  },
});

const OrderModel = defineModel<TestSchema, 'orders'>()({
  table: 'orders',
  label: 'Orders',
  dimensions: {
    country: { column: 'country', type: 'string', label: 'Country' },
    status:  { column: 'status',  type: 'string', label: 'Order Status' },
    created: { column: 'created_at', type: 'time', label: 'Created At' },
  },
  measures: {
    revenue:    { column: 'amount', type: 'sum',   label: 'Total Revenue' },
    orderCount: { column: 'id',     type: 'count', label: 'Order Count' },
    avgOrder:   { column: 'amount', type: 'avg',   label: 'Avg Order Value' },
  },
  relationships: {
    customer: {
      model: () => CustomerModel,
      join: { from: 'user_id', to: 'id' },
      type: 'manyToOne' as const,
    },
  },
});

// Model has the correct __type brand
type _ModelBrand = Expect<Equal<typeof OrderModel['__type'], 'semantic_model'>>;

// Model table is narrowed
type _ModelTable = Expect<Equal<typeof OrderModel['table'], 'orders'>>;

// Dimensions are preserved
type _HasCountryDim = Expect<Equal<typeof OrderModel['dimensions']['country']['type'], 'string'>>;
type _HasCreatedDim = Expect<Equal<typeof OrderModel['dimensions']['created']['type'], 'time'>>;

// Measures are preserved
type _HasRevenueMeasure = Expect<Equal<typeof OrderModel['measures']['revenue']['type'], 'sum'>>;

// Column references are type-safe against the schema
const _badDimension = defineModel<TestSchema, 'orders'>()({
  table: 'orders',
  dimensions: {
    // @ts-expect-error — 'nonexistent' is not a column on 'orders'
    bad: { column: 'nonexistent', type: 'string' },
  },
  measures: {},
});

const _badMeasure = defineModel<TestSchema, 'orders'>()({
  table: 'orders',
  dimensions: {},
  measures: {
    // @ts-expect-error — 'nonexistent' is not a column on 'orders'
    bad: { column: 'nonexistent', type: 'sum' },
  },
});

// ---------------------------------------------------------------------------
// dataset builder: fluent API + type inference
// ---------------------------------------------------------------------------

const revenueByCountry = dataset(OrderModel)
  .dimensions(['country', 'status'])
  .measures(['revenue', 'orderCount']);

// Result type is inferred from selected dimensions + measures
type RevenueRow = InferDatasetResult<typeof revenueByCountry>;
type _RevenueRowCheck = Expect<Equal<RevenueRow, {
  country: string;
  status: string;
} & {
  revenue: number;
  orderCount: number;
}>>;

// Dimensions only — no measures
const dimsOnly = dataset(OrderModel)
  .dimensions(['country']);

type DimsOnlyRow = InferDatasetResult<typeof dimsOnly>;
type _DimsOnlyCheck = Expect<Equal<DimsOnlyRow, { country: string } & {}>>;

// Measures only — grand total
const measuresOnly = dataset(OrderModel)
  .measures(['revenue', 'avgOrder']);

type MeasuresOnlyRow = InferDatasetResult<typeof measuresOnly>;
type _MeasuresOnlyCheck = Expect<Equal<MeasuresOnlyRow, {} & { revenue: number; avgOrder: number }>>;

// Chaining: filter, orderBy, limit
const withFilters = dataset(OrderModel)
  .dimensions(['country'])
  .measures(['revenue'])
  .filter([{ dimension: 'status', operator: 'eq', value: 'completed' }])
  .orderBy([{ field: 'revenue', direction: 'desc' }])
  .limit(50);

type FilteredRow = InferDatasetResult<typeof withFilters>;
type _FilteredRowCheck = Expect<Equal<FilteredRow, { country: string } & { revenue: number }>>;

// toConfig() returns a serializable config object
const config = revenueByCountry.toConfig();
const _configModel: string = config.model;
const _configDims: string[] = config.dimensions;
const _configMeasures: string[] = config.measures;

// Cross-model includes
const withInclude = dataset(OrderModel)
  .dimensions(['country'])
  .measures(['revenue'])
  .include([{ through: 'customer', dimensions: ['name', 'tier'] }]);

const _badInclude = dataset(OrderModel)
  // @ts-expect-error — 'nonexistent' is not a relationship on OrderModel
  .include([{ through: 'nonexistent' }]);

// Dimension selection is type-safe
// @ts-expect-error — 'nonexistent' is not a dimension on OrderModel
const _badDimSelect = dataset(OrderModel).dimensions(['nonexistent']);

// Measure selection is type-safe
// @ts-expect-error — 'nonexistent' is not a measure on OrderModel
const _badMeasureSelect = dataset(OrderModel).measures(['nonexistent']);
