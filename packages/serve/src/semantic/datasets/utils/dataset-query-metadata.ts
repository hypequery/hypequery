import type { DatasetInstance } from '@hypequery/datasets';

export function buildDatasetQueryDescription(
  ds: DatasetInstance,
  maxLimit: number,
): string {
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = Object.keys(ds.measures);
  const lines = [
    `Query the ${ds.name} semantic dataset (source: ${ds.source}).`,
    '',
    `**Dimensions:** ${dimensionNames.join(', ') || 'none'}`,
    `**Measures:** ${measureNames.join(', ') || 'none'}`,
    `**Max limit:** ${maxLimit}`,
  ];

  return lines.join('\n');
}
