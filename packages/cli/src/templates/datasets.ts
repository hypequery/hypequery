/**
 * Generate placeholder datasets.ts file for no-connection init.
 */
export function generateDatasetsPlaceholderTemplate(): string {
  return `import { dataset, dimension, measure } from '@hypequery/datasets';

const exampleEvents = dataset('example_events', {
  source: 'example_events',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    eventCount: measure.count('id', { label: 'Event Count' }),
  },
});

export const datasets = {
  exampleEvents,
};
`;
}

