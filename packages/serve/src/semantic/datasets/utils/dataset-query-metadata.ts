import { getDatasetCatalog, type AnyDatasetInstance } from '@hypequery/datasets';

export function buildDatasetQueryDescription(
  ds: AnyDatasetInstance,
  maxLimit: number,
): string {
  const catalog = getDatasetCatalog(ds);
  const dimensionNames = Object.keys(catalog.dimensions);
  const measureNames = Object.keys(catalog.measures);
  const filterNames = Object.keys(catalog.filters);
  const relationshipNames = Object.keys(catalog.relationships);
  const lines = [
    `Query the ${catalog.name} semantic dataset (source: ${catalog.source}).`,
    '',
    `**Dimensions:** ${dimensionNames.join(', ') || 'none'}`,
    `**Measures:** ${measureNames.join(', ') || 'none'}`,
    `**Filters:** ${filterNames.join(', ') || 'none'}`,
    `**Time grains:** ${catalog.supportedGrains.join(', ') || 'none'}`,
    `**Relationships:** ${relationshipNames.join(', ') || 'none'}`,
    `**Tenant scoped:** ${catalog.requiresTenant ? 'yes' : 'no'}`,
    `**Max limit:** ${maxLimit}`,
  ];

  return lines.join('\n');
}
