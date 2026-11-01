import type { SemanticFilterDefinition } from '../types.js';

/** The parts of a filter definition that decide what a caller may filter on. */
export interface FilterPolicy {
  readonly field: string;
  readonly operators?: readonly string[];
}

interface FilterPolicySource<TFilter extends FilterPolicy> {
  readonly filters: Readonly<Record<string, TFilter>>;
  readonly dimensions: Readonly<Record<string, { readonly filterable?: boolean }>>;
}

/**
 * The filters a caller may apply: the declared filters, plus one per
 * filterable dimension that no declared filter is named after.
 *
 * Declared filters add to the dimensions marked filterable rather than
 * replacing them. A declared filter keeps its own name, field and operators,
 * and can expose a dimension marked `filterable: false`. A dimension's own
 * filter takes the operators of the declared filters on its field, so a
 * declaration that narrows a field's operators cannot be bypassed by naming
 * the dimension directly. Without one it gets the default list, which has no
 * null checks (RFC 0023).
 */
export function effectiveFilters<TFilter extends FilterPolicy>(
  source: FilterPolicySource<TFilter>,
): Record<string, TFilter | SemanticFilterDefinition> {
  const filters: Record<string, TFilter | SemanticFilterDefinition> = { ...source.filters };
  for (const [name, dimension] of Object.entries(source.dimensions)) {
    if (dimension.filterable === false || Object.hasOwn(filters, name)) continue;
    const operators = declaredOperators(Object.values(source.filters), name);
    filters[name] = {
      __type: 'filter_definition',
      field: name,
      ...(operators ? { operators: operators as SemanticFilterDefinition['operators'] } : {}),
    };
  }
  return filters;
}

/**
 * The operators the declared filters on `field` allow between them, or
 * undefined when none is declared or one allows the default list.
 */
function declaredOperators(filters: readonly FilterPolicy[], field: string): string[] | undefined {
  const declared = filters.filter(filter => filter.field === field);
  if (declared.length === 0 || declared.some(filter => !filter.operators)) return undefined;
  return [...new Set(declared.flatMap(filter => filter.operators ?? []))];
}
