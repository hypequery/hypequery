import {
  dataset, dimension, divide, getDatasetCatalog, measure, projectAgentSafeCatalog,
  type DatasetRowFor, type AgentCatalogMeasure, type MeasureCatalogEntry,
} from '../src/index.js';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

const Events = dataset('events', {
  source: 'events', timeKey: 'time', dimensions: { time: dimension.timestamp() },
  measures: {
    revenue: measure.sum('amount'), rolling: measure.trailing('revenue', { amount: 7, unit: 'day' }),
    ratio: measure.derived({ uses: { rolling: 'rolling', revenue: 'revenue' }, formula: ({ rolling, revenue }) => divide(rolling, revenue) }),
  },
});
type WindowRow = DatasetRowFor<typeof Events, { by: 'day'; measures: ['rolling', 'ratio'] }>;
type WindowResult = Assert<Equal<WindowRow['rolling'], string | null | undefined>>;
type FormulaResult = Assert<Equal<WindowRow['ratio'], string | null | undefined>>;
type VisibleColumns = Assert<Equal<keyof WindowRow, 'period' | 'rolling' | 'ratio'>>;
type AgentRangeRequirement = Assert<Equal<AgentCatalogMeasure['requiresTimeRange'], true | undefined>>;
type CatalogWindowKind = Assert<Equal<MeasureCatalogEntry['kind'], 'window' | undefined>>;

const catalog = getDatasetCatalog(Events);
const agent = projectAgentSafeCatalog({ Events });
void catalog.measures.rolling.trailing?.amount;
void agent.datasets[0].measures[0].requiresTimeRange;
