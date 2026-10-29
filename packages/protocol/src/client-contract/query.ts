import { clientError, ProtocolClientContractError } from './errors.js';
import type { ProtocolClientEndpoint } from './types.js';
import { validateProtocolClientContract } from './validate.js';
import { record, shape, integer, timezone } from './primitives.js';
import { freezeClientData, snapshotClientData } from './safe-data.js';
import { isProtocolNullCheckOperator } from '../expressions/null-checks.js';

export interface ClientQueryPlan {
  readonly endpoint: ProtocolClientEndpoint;
  readonly body: Readonly<Record<string, unknown>>;
  readonly selectedMeasures: readonly string[];
  readonly effectiveLimit: number;
}
function array(input: unknown, maximum: number): unknown[] {
  if (!Array.isArray(input) || input.length > maximum) clientError('HQ_CLIENT_QUERY');
  return input;
}
function strings(input: unknown, allowed: readonly string[], maximum: number): string[] {
  const values = array(input, maximum);
  if (values.some(v => typeof v !== 'string' || !allowed.includes(v))
    || new Set(values).size !== values.length) clientError('HQ_CLIENT_QUERY');
  return values as string[];
}
function predicateValue(value: unknown, type: string, operator: string, maximum: number): void {
  const values = operator === 'between' || operator === 'in' || operator === 'notIn'
    ? array(value, operator === 'between' ? 2 : maximum) : [value];
  if (values.length === 0 || (operator === 'between' && values.length !== 2)) clientError('HQ_CLIENT_QUERY');
  for (const item of values) {
    if (type === 'number' ? typeof item !== 'number' || !Number.isFinite(item)
      : type === 'boolean' ? typeof item !== 'boolean' : typeof item !== 'string') clientError('HQ_CLIENT_QUERY');
  }
}
function bodyFor(endpoint: ProtocolClientEndpoint, source: Record<string, unknown>, transport: 'http' | 'mcp'): ClientQueryPlan {
  const keys = ['dimensions', 'filters', 'orderBy', 'limit', 'offset', 'includeMeta',
    ...(endpoint.kind === 'dataset' ? ['measures', 'having'] : []),
    ...(endpoint.time ? ['by', ...(endpoint.time.timezone ? ['timezone'] : [])] : [])];
  if (Object.keys(source).some(key => !keys.includes(key))) clientError('HQ_CLIENT_QUERY');
  const caps = endpoint.limits;
  const dimensions = strings(source.dimensions === undefined ? [] : source.dimensions,
    Object.keys(endpoint.dimensions).filter(key => endpoint.dimensions[key].groupable), caps.maxDimensions);
  const selectedMeasures = endpoint.kind === 'metric' ? Object.keys(endpoint.measures)
    : strings(source.measures === undefined ? endpoint.defaultMeasures : source.measures,
      Object.keys(endpoint.measures), caps.maxMeasures);
  if (!dimensions.length && !selectedMeasures.length && source.by === undefined) clientError('HQ_CLIENT_QUERY');
  const filters = array(source.filters === undefined ? [] : source.filters, caps.maxPredicates);
  for (const item of filters) {
    // A null check names no value (RFC 0023), so one carrying `value` fails as an unknown member.
    const nullCheck = isProtocolNullCheckOperator(record(item, '').operator);
    const filter = shape(item, nullCheck ? ['field', 'operator'] : ['field', 'operator', 'value'], '');
    if (typeof filter.field !== 'string' || !Object.hasOwn(endpoint.filters, filter.field)) clientError('HQ_CLIENT_QUERY');
    const definition = endpoint.filters[filter.field];
    if (typeof filter.operator !== 'string' || !definition.operators.includes(filter.operator)) clientError('HQ_CLIENT_QUERY');
    if (!nullCheck) predicateValue(filter.value, definition.type, filter.operator, caps.maxFilterValues);
  }
  const having = array(source.having === undefined ? [] : source.having, caps.maxPredicates - filters.length);
  for (const item of having) {
    const condition = shape(item, ['measure', 'operator', 'value'], '');
    if (typeof condition.measure !== 'string' || !selectedMeasures.includes(condition.measure)
      || !endpoint.measures[condition.measure].having
      || typeof condition.operator !== 'string'
      || !['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn'].includes(condition.operator)) clientError('HQ_CLIENT_QUERY');
    predicateValue(condition.value, 'number', condition.operator, caps.maxFilterValues);
  }
  if (source.by !== undefined && (typeof source.by !== 'string' || !endpoint.time?.grains.includes(source.by))) clientError('HQ_CLIENT_QUERY');
  if (source.timezone !== undefined) timezone(source.timezone, '/timezone');
  const orderBy = array(source.orderBy === undefined ? [] : source.orderBy, caps.maxOrderBy);
  const orderable = [...dimensions.filter(key => endpoint.dimensions[key].orderable),
    ...selectedMeasures, ...(source.by === undefined ? [] : ['period'])];
  const ordered = new Set<string>();
  for (const item of orderBy) {
    const order = shape(item, ['field', 'direction'], '');
    if (typeof order.field !== 'string' || !orderable.includes(order.field) || ordered.has(order.field)
      || (order.direction !== 'asc' && order.direction !== 'desc')) clientError('HQ_CLIENT_QUERY');
    ordered.add(order.field);
  }
  // HTTP clamps a larger limit; an agent is refused one, so it never reads a
  // silently shortened page as the whole answer.
  const effectiveLimit = Math.min(source.limit === undefined ? caps.defaultLimit
    : integer(source.limit, 1, transport === 'mcp' ? caps.maxLimit : Number.MAX_SAFE_INTEGER, '/limit'), caps.maxLimit);
  const offset = source.offset === undefined ? 0 : integer(source.offset, 0, caps.maxOffset, '/offset');
  if (source.includeMeta !== undefined && typeof source.includeMeta !== 'boolean') clientError('HQ_CLIENT_QUERY');
  if (source.includeMeta === true && !endpoint.metadata) clientError('HQ_CLIENT_QUERY');
  const body = { dimensions, filters, orderBy, limit: effectiveLimit, offset,
    includeMeta: source.includeMeta ?? false,
    ...(endpoint.kind === 'dataset' ? { measures: selectedMeasures, having } : {}),
    ...(source.by === undefined ? {} : { by: source.by }),
    ...(source.timezone === undefined ? {} : { timezone: source.timezone }) };
  return freezeClientData({ endpoint, body, selectedMeasures, effectiveLimit });
}
/** Normalize HTTP or MCP input under a signed contract; routing never comes from a tool URL. */
export function validateProtocolClientQuery(
  contract: unknown, endpointId: string, input: unknown, transport: 'http' | 'mcp' = 'http',
): ClientQueryPlan {
  const validated = validateProtocolClientContract(contract);
  try {
    const endpoint = validated.endpoints.find(item => item.id === endpointId);
    if (!endpoint) clientError('HQ_CLIENT_QUERY');
    const source = record(snapshotClientData(input), '');
    if (transport === 'mcp') {
      if (source.dataset !== endpoint.dataset || (endpoint.kind === 'metric'
        ? source.metric !== endpoint.id : Object.hasOwn(source, 'metric'))) clientError('HQ_CLIENT_QUERY');
      delete source.dataset;
      delete source.metric;
      if (Object.hasOwn(source, 'by')) clientError('HQ_CLIENT_QUERY');
      if (Object.hasOwn(source, 'grain')) { source.by = source.grain; delete source.grain; }
    } else if (transport !== 'http') clientError('HQ_CLIENT_QUERY');
    return bodyFor(endpoint, source, transport);
  } catch (error) {
    if (error instanceof ProtocolClientContractError) clientError('HQ_CLIENT_QUERY', error.path);
    throw error;
  }
}
