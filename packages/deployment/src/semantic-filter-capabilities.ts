import type {
  ProtocolDatasetFilter,
  ProtocolDeploymentDataset,
  ProtocolDeploymentDatasetAnyVersion,
} from '@hypequery/protocol';

/** The dataset layer's default caller-filter operators; null checks are opt-in. */
export const DEFAULT_SEMANTIC_FILTER_OPERATORS: ReadonlySet<string> = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'like',
]);

export interface ProtocolFilterCapabilities {
  /** Every declared filter, including aliases. */
  readonly named: ReadonlyMap<string, ProtocolDatasetFilter>;
  /** Dimension-name filters exactly as the dataset layer's effectiveFilters exposes them. */
  readonly dimensions: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Resolves the filter surface serialized in a deployment contract using the
 * same rules as datasets' effectiveFilters:
 *
 * - a declared filter remains reachable by its own name;
 * - a same-named declaration defines a dimension filter, even when the
 *   dimension itself is not filterable, provided it addresses that dimension;
 * - another declaration on the dimension's field narrows its implied
 *   operators; and
 * - otherwise a filterable dimension gets the value-operator defaults.
 */
export function protocolFilterCapabilities(
  dataset: ProtocolDeploymentDatasetAnyVersion,
): ProtocolFilterCapabilities {
  const allowList = 'allowedFilters' in dataset && dataset.allowedFilters !== undefined
    ? dataset.allowedFilters
    : (dataset as ProtocolDeploymentDataset).filters;
  const named = new Map(allowList.map(filter => [String(filter.name), filter]));
  const dimensions = new Map<string, ReadonlySet<string>>();

  for (const dimension of dataset.dimensions) {
    const name = String(dimension.name);
    const sameNamed = named.get(name);
    if (sameNamed) {
      if (String(sameNamed.field) === name) {
        dimensions.set(name, new Set(sameNamed.operators));
      }
      continue;
    }
    if (!dimension.filterable) continue;
    const onField = allowList.filter(filter => String(filter.field) === name);
    dimensions.set(
      name,
      onField.length > 0
        ? new Set(onField.flatMap(filter => filter.operators))
        : DEFAULT_SEMANTIC_FILTER_OPERATORS,
    );
  }

  return { named, dimensions };
}
