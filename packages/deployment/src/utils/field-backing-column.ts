import type { ProtocolDeploymentDatasetAnyVersion } from '@hypequery/protocol';

/**
 * The physical column a dataset field reads: a column dimension's column, or
 * the name itself otherwise. A contract's time field may name either a
 * dimension or the column one reads, so time-axis checks compare these, as
 * the dataset planner does (RFC 0029).
 */
export function fieldBackingColumn(dataset: ProtocolDeploymentDatasetAnyVersion, name: string): string {
  const dimension = dataset.dimensions.find(candidate => String(candidate.name) === name);
  return dimension?.source.kind === 'column' ? dimension.source.column : name;
}

/**
 * True when a time axis is visible: a visible dimension is named by it or
 * reads the column it names (RFC 0029). An axis no dimension reads cannot be
 * shown by a policy, so it stays hidden.
 */
export function isTimeAxisVisible(
  dataset: ProtocolDeploymentDatasetAnyVersion,
  axis: string,
  visibleDimensions: ReadonlySet<string>,
): boolean {
  if (visibleDimensions.has(axis)) return true;
  return dataset.dimensions.some(dimension => (
    visibleDimensions.has(String(dimension.name)) && fieldBackingColumn(dataset, String(dimension.name)) === axis
  ));
}
