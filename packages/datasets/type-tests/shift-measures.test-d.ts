import {
  dataset, dimension, divide, measure, type DatasetRowFor, type DatasetClient,
  type ShiftMeasureDefinition, type AgentCatalogMeasure,
} from '../src/index.js';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

const Events = dataset('events', { source: 'events', timeKey: 'time', dimensions: { time: dimension.timestamp() },
  measures: {
    revenue: measure.sum('amount'), prior: measure.shift('revenue', { amount: 1, unit: 'year' }),
    growth: measure.derived({ uses: { now: 'revenue', prior: 'prior' }, formula: ({ now, prior }) => divide(now, prior) }),
  },
});
const definition: ShiftMeasureDefinition<'revenue'> = Events.measures.prior;
void definition.interval.amount;
type Row = DatasetRowFor<typeof Events, { by: 'month'; measures: ['prior', 'growth'] }>;
type ShiftColumn = Assert<Equal<Row['prior'], string | null | undefined>>;
type FormulaColumn = Assert<Equal<Row['growth'], string | null | undefined>>;
type VisibleColumns = Assert<Equal<keyof Row, 'period' | 'prior' | 'growth'>>;
type DefaultColumns = Assert<Equal<keyof DatasetRowFor<typeof Events, {}>, 'revenue'>>;
type AgentKind = Assert<Equal<AgentCatalogMeasure['kind'], 'window' | 'shift' | undefined>>;

// @ts-expect-error There is one public measure registry.
void Events.shiftMeasures;
// @ts-expect-error Standalone metrics remain base-only.
Events.metric('invalid', { measure: 'prior' });
// @ts-expect-error Intervals require an amount and a unit.
measure.shift('revenue', { amount: 1 });
// @ts-expect-error Interval units come from the supported grain registry.
measure.shift('revenue', { amount: 1, unit: 'fortnight' });

declare const client: DatasetClient;
client.execute(Events, { by: 'month', measures: ['prior', 'growth'], filters: [{ field: 'time', operator: 'between', value: ['2026-01-01', '2026-12-31'] }] }).then(result => {
  type SelectedShift = Assert<Equal<typeof result.data[number]['prior'], string | null | undefined>>;
  // @ts-expect-error Formula dependencies are hidden unless selected.
  void result.data[0].revenue;
});

dataset('invalidTarget', { source: 'events', timeKey: 'time', dimensions: { time: dimension.timestamp() }, measures: {
  revenue: measure.sum('amount'), prior: measure.shift('revenue', { amount: 1, unit: 'year' }),
  twice: measure.shift('prior', { amount: 1, unit: 'year' }),
} });

const Composed = dataset('composed', { source: 'events', timeKey: 'time', dimensions: { time: dimension.timestamp() }, measures: {
  revenue: measure.sum('value'), ytd: measure.toDate('revenue', 'year'),
  priorYtd: measure.shift('ytd', { amount: 1, unit: 'year' }),
  ratio: measure.derived({ uses: { now: 'ytd', prior: 'priorYtd' }, formula: ({ now, prior }) => divide(now, nullIfZero(prior)) }),
  priorRatio: measure.shift('ratio', { amount: 1, unit: 'year' }),
  ratioGrowth: measure.derived({ uses: { now: 'ratio', prior: 'priorRatio' }, formula: ({ now, prior }) => divide(now, nullIfZero(prior)) }),
} });
client.execute(Composed, { by: 'month', measures: ['priorYtd', 'ratioGrowth'], filters: [{ field: 'time', operator: 'between', value: ['2024-01-01', '2024-02-01'] }] });
