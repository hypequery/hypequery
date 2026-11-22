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
