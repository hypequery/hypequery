import type {
  ProtocolDeploymentContract,
  ProtocolDeploymentDataset,
  ProtocolDeploymentMeasure,
  ProtocolSemanticMetadata,
  ProtocolSqlExpression,
} from '@hypequery/protocol';

import { byName } from '../../utils/by-name.js';
import { compareStrings } from '../../utils/canonical-json.js';

const sorted = <T>(values: readonly T[]): T[] =>
  [...values].sort((left, right) => compareStrings(String(left), String(right)));

/** `examples` and `synonyms` sorted, as `snapshotSemanticMetadata` writes them. */
function metadataOrder<T extends ProtocolSemanticMetadata>(item: T): T {
  return {
    ...item,
    ...(item.examples !== undefined ? { examples: sorted(item.examples) } : {}),
    ...(item.synonyms !== undefined ? { synonyms: sorted(item.synonyms) } : {}),
  };
}

/** SQL `dependencies` sorted, as `protocol-adapter.ts` writes them. */
function sqlOrder(expression: ProtocolSqlExpression): ProtocolSqlExpression {
  return { ...expression, dependencies: sorted(expression.dependencies) };
}

/**
 * A contract with its named members in the order `dataset()` code produces
 * them: datasets, dimensions, filters and relationships by name, and base
 * measures by name followed by derived measures by name. The lists the
 * adapter sorts inside a member are sorted too: `examples`, `synonyms` and SQL
 * `dependencies` (all duplicate-free once validated).
 *
 * Code can't keep any other order, because `protocol-adapter.ts` sorts these
 * lists, so nothing in a contract depends on it. Cloud's editor appends
 * members as they're added, so exporting a Cloud model gives code whose
 * contract equals this, not always the input byte for byte. Any other order
 * inside a member (filter operators, relationship keys, `uses`, `defaults`)
 * is kept.
 */
export function canonicalMemberOrder(contract: ProtocolDeploymentContract): ProtocolDeploymentContract {
  const named = <T extends { readonly name: unknown }>(items: readonly T[]): T[] =>
    [...items].sort((left, right) => byName({ name: String(left.name) }, { name: String(right.name) }));
  const isDerived = (measure: ProtocolDeploymentMeasure) => 'kind' in measure && measure.kind === 'derived';
  return {
    ...contract,
    datasets: named(contract.datasets).map((dataset): ProtocolDeploymentDataset => ({
      ...metadataOrder(dataset),
      dimensions: named(dataset.dimensions).map(dimension => ({
        ...metadataOrder(dimension),
        source: dimension.source.kind === 'sql-expression' ? sqlOrder(dimension.source) : dimension.source,
      })),
      measures: [
        ...named(dataset.measures.filter(measure => !isDerived(measure))).map(measure => {
          const ordered = metadataOrder(measure);
          return 'sql' in ordered && ordered.sql !== undefined ? { ...ordered, sql: sqlOrder(ordered.sql) } : ordered;
        }),
        ...named(dataset.measures.filter(isDerived)).map(metadataOrder),
      ],
      filters: named(dataset.filters).map(metadataOrder),
      relationships: named(dataset.relationships),
    })),
  };
}
