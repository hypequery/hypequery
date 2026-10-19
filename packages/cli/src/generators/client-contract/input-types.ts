import type { ClientFilter, ProtocolClientEndpoint } from '@hypequery/protocol';

export const literal = (value: string): string => JSON.stringify(value);
export const union = (values: readonly string[]): string => values.length ? values.join(' | ') : 'never';
export const names = (values: readonly string[]): string => union([...values].sort().map(literal));

function predicate(field: string, definition: ClientFilter, having = false): string[] {
  const scalar = definition.type === 'number' ? 'number' : definition.type === 'boolean' ? 'boolean' : 'string';
  return [...definition.operators].sort().map(operator => {
    const value = operator === 'between' ? `readonly [${scalar}, ${scalar}]`
      : operator === 'in' || operator === 'notIn' ? `readonly [${scalar}, ...${scalar}[]]` : scalar;
    return `{ readonly ${having ? 'measure' : 'field'}: ${literal(field)}; readonly operator: ${literal(operator)}; readonly value: ${value} }`;
  });
}

/** Structural types mirror the closed profile; runtime also checks selection dependencies and budgets. */
export function clientInputType(endpoint: ProtocolClientEndpoint): string {
  const dimensions = Object.keys(endpoint.dimensions).filter(key => endpoint.dimensions[key].groupable);
  const measures = Object.keys(endpoint.measures);
  const filters = Object.keys(endpoint.filters).sort().flatMap(key => predicate(key, endpoint.filters[key]));
  const having = measures.filter(key => endpoint.measures[key].having).sort().flatMap(key => predicate(key, {
    type: 'number', operators: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn'],
  }, true));
  const ordered = [...dimensions.filter(key => endpoint.dimensions[key].orderable), ...measures,
    ...(endpoint.time ? ['period'] : [])];
  return `{
    readonly dimensions?: readonly (${names(dimensions)})[];
    readonly filters?: readonly (${union(filters)})[];
    readonly orderBy?: readonly { readonly field: ${names(ordered)}; readonly direction: 'asc' | 'desc' }[];
    readonly limit?: number;
    readonly offset?: number;
    readonly includeMeta?: ${endpoint.metadata ? 'boolean' : 'false'};
    ${endpoint.kind === 'dataset' ? `readonly measures?: readonly (${names(measures)})[];
    readonly having?: readonly (${union(having)})[];` : ''}
    ${endpoint.time ? `readonly by?: ${names(endpoint.time.grains)};
    ${endpoint.time.timezone ? 'readonly timezone?: string;' : ''}` : ''}
  }`;
}
