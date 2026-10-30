import type {
  ClientDimension,
  ClientFilter,
  ClientMeasure,
  ProtocolDatasetDimension,
  ProtocolDatasetFilter,
  ProtocolDeploymentDataset,
  ProtocolDeploymentMeasure,
  ProtocolExpression,
} from '@hypequery/protocol';

// As Python's builder: booleans compare by equality and membership only.
const BOOLEAN_OPERATORS = new Set(['eq', 'neq', 'in', 'notIn']);
const ORDERED_AGGREGATIONS = new Set(['min', 'max', 'argMin', 'argMax']);
/** Stored states whose merged value is the stored value itself, which may not be a number. */
const ORDERED_STATES = new Set(['min', 'max', 'any', 'anyLast']);

/** Local fields have unknown nullability; the client contract says so rather than guess. */
export function dimensionDescriptor(dimension: ProtocolDatasetDimension): ClientDimension {
  return {
    type: dimension.type,
    wireType: dimension.type === 'number' ? 'number-or-string' : dimension.type === 'boolean' ? 'boolean' : 'string',
    nullable: 'unknown',
    groupable: dimension.groupable,
    orderable: dimension.groupable,
  };
}

/** `having` compares numbers, so ordered aggregations over non-numeric fields can't take it. */
export function measureDescriptor(dataset: ProtocolDeploymentDataset, measure: ProtocolDeploymentMeasure): ClientMeasure {
  if ('kind' in measure) return { wireType: 'string', nullable: true, having: true };
  if (measure.aggregation === 'merge') {
    return { wireType: 'string', nullable: true, having: !ORDERED_STATES.has(String(measure.stateFunction)) };
  }
  if (!ORDERED_AGGREGATIONS.has(measure.aggregation)) {
    return { wireType: 'string', nullable: true, having: true };
  }
  const dimension = dataset.dimensions.find(item => item.name as string === measure.field as string);
  return { wireType: 'string', nullable: true, having: dimension?.type === 'number' };
}

export function filterDescriptor(dimension: ProtocolDatasetDimension, filter: ProtocolDatasetFilter): ClientFilter | null {
  const operators = [...new Set(filter.operators.filter(operator => dimension.type === 'boolean'
    ? BOOLEAN_OPERATORS.has(operator)
    : dimension.type !== 'number' || operator !== 'like'))].sort();
  return operators.length ? { type: dimension.type, operators } : null;
}

/** Tenant identities come from the caller's credential, never from request predicates. */
export function requestFilter(dataset: ProtocolDeploymentDataset, dimension: ProtocolDatasetDimension): boolean {
  if (dataset.tenant.kind !== 'required') return true;
  const column = dimension.source.kind === 'column' ? dimension.source.column : dimension.name;
  return column !== dataset.tenant.field;
}

function expressionFields(expression: ProtocolExpression): string[] {
  switch (expression.kind) {
    case 'reference': return [expression.name];
    case 'aggregate': return [expression.field];
    case 'binary': return [...expressionFields(expression.left), ...expressionFields(expression.right)];
    case 'call': return expression.args.flatMap(expressionFields);
    case 'comparison': return 'right' in expression
      ? [...expressionFields(expression.left), ...expressionFields(expression.right)]
      : expressionFields(expression.left);
    case 'logical': return 'operands' in expression ? expression.operands.flatMap(expressionFields) : expressionFields(expression.operand);
    default: return [];
  }
}

/** The fields a measure's fixed filters read, through any derived dependencies. */
function measureFilterFields(dataset: ProtocolDeploymentDataset, name: string): string[] {
  const filters = new Map(dataset.filters.map(filter => [filter.name as string, filter.field as string]));
  const measures = new Map(dataset.measures.map(measure => [measure.name as string, measure]));
  const pending = [name];
  const seen = new Set<string>();
  const fields: string[] = [];
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const measure = measures.get(current);
    if (measure === undefined) continue;
    if ('kind' in measure) pending.push(...measure.uses.map(use => use.measure));
    else for (const field of measure.filters.flatMap(expressionFields)) fields.push(filters.get(field) ?? field);
  }
  return fields;
}

/**
 * The fields one dataset endpoint advertises. Relationship fields are not
 * exported yet, matching Python's default (`related=()`), so a measure whose
 * fixed filters cross a relationship is left out rather than advertised.
 */
export function publicFields(dataset: ProtocolDeploymentDataset): {
  dimensions: Record<string, ClientDimension>;
  measures: Record<string, ClientMeasure>;
  filters: Record<string, ClientFilter>;
} {
  const dimensions = Object.fromEntries(dataset.dimensions.map(dimension => [dimension.name, dimensionDescriptor(dimension)]));
  const measures = Object.fromEntries(dataset.measures
    .filter(measure => measureFilterFields(dataset, measure.name).every(field => !field.includes('.')))
    .map(measure => [measure.name, measureDescriptor(dataset, measure)]));
  // Built with Object.fromEntries, as above: assigning a key such as
  // `__proto__` would set the prototype instead of adding an entry.
  const filters = Object.fromEntries(dataset.filters.flatMap((filter): [string, ClientFilter][] => {
    if (filter.field.includes('.')) return [];
    const dimension = dataset.dimensions.find(item => item.name as string === filter.field as string);
    if (dimension === undefined) {
      throw new Error(`Client export: filter "${dataset.name}.${filter.name}" references unknown dimension "${filter.field}".`);
    }
    if (!requestFilter(dataset, dimension)) return [];
    const descriptor = filterDescriptor(dimension, filter);
    return descriptor ? [[filter.name, descriptor]] : [];
  }));
  return { dimensions, measures, filters };
}
