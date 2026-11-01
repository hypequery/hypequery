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
function array(input: unknown, maximum: number, path: string): unknown[] {
  if (!Array.isArray(input) || input.length > maximum) clientError('HQ_CLIENT_QUERY', path);
  return input;
}
function strings(input: unknown, allowed: readonly string[], maximum: number, path: string): string[] {
  const values = array(input, maximum, path);
  const seen = new Set<unknown>();
  values.forEach((value, index) => {
    if (typeof value !== 'string' || !allowed.includes(value) || seen.has(value)) clientError('HQ_CLIENT_QUERY', `${path}/${index}`);
    seen.add(value);
  });
  return values as string[];
}
function predicateValue(value: unknown, type: string, operator: string, maximum: number, path: string): void {
  const values = operator === 'between' || operator === 'in' || operator === 'notIn'
    ? array(value, operator === 'between' ? 2 : maximum, path) : [value];
  if (values.length === 0 || (operator === 'between' && values.length !== 2)) clientError('HQ_CLIENT_QUERY', path);
  for (const item of values) {
    if (type === 'number' ? typeof item !== 'number' || !Number.isFinite(item)
      : type === 'boolean' ? typeof item !== 'boolean' : typeof item !== 'string') clientError('HQ_CLIENT_QUERY', path);
  }
}
function bodyFor(endpoint: ProtocolClientEndpoint, source: Record<string, unknown>, transport: 'http' | 'mcp'): ClientQueryPlan {
  const keys = ['dimensions', 'filters', 'orderBy', 'limit', 'offset', 'includeMeta',
    ...(endpoint.kind === 'dataset' ? ['measures', 'having'] : []),
    ...(endpoint.time ? ['by', ...(endpoint.time.timezone ? ['timezone'] : [])] : [])];
  // An unknown member is reported at the root: its name is submitted data.
  if (Object.keys(source).some(key => !keys.includes(key))) clientError('HQ_CLIENT_QUERY');
  const caps = endpoint.limits;
  const dimensions = strings(source.dimensions === undefined ? [] : source.dimensions,
    Object.keys(endpoint.dimensions).filter(key => endpoint.dimensions[key].groupable), caps.maxDimensions, '/dimensions');
  const selectedMeasures = endpoint.kind === 'metric' ? Object.keys(endpoint.measures)
    : strings(source.measures === undefined ? endpoint.defaultMeasures : source.measures,
      Object.keys(endpoint.measures), caps.maxMeasures, '/measures');
  if (!dimensions.length && !selectedMeasures.length && source.by === undefined) clientError('HQ_CLIENT_QUERY');
  const filters = array(source.filters === undefined ? [] : source.filters, caps.maxPredicates, '/filters');
  filters.forEach((item, index) => {
    const path = `/filters/${index}`;
    // A null check names no value (RFC 0023), so one carrying `value` fails as an unknown member.
    const nullCheck = isProtocolNullCheckOperator(record(item, path).operator);
    const filter = shape(item, nullCheck ? ['field', 'operator'] : ['field', 'operator', 'value'], path);
    if (typeof filter.field !== 'string' || !Object.hasOwn(endpoint.filters, filter.field)) clientError('HQ_CLIENT_QUERY', `${path}/field`);
    const definition = endpoint.filters[filter.field];
    if (typeof filter.operator !== 'string' || !definition.operators.includes(filter.operator)) clientError('HQ_CLIENT_QUERY', `${path}/operator`);
    if (!nullCheck) predicateValue(filter.value, definition.type, filter.operator, caps.maxFilterValues, `${path}/value`);
  });
  const having = array(source.having === undefined ? [] : source.having, caps.maxPredicates - filters.length, '/having');
  having.forEach((item, index) => {
    const path = `/having/${index}`;
    const condition = shape(item, ['measure', 'operator', 'value'], path);
    if (typeof condition.measure !== 'string' || !selectedMeasures.includes(condition.measure)
      || !endpoint.measures[condition.measure].having) clientError('HQ_CLIENT_QUERY', `${path}/measure`);
    if (typeof condition.operator !== 'string'
      || !['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn'].includes(condition.operator)) clientError('HQ_CLIENT_QUERY', `${path}/operator`);
    predicateValue(condition.value, 'number', condition.operator, caps.maxFilterValues, `${path}/value`);
  });
  if (source.by !== undefined && (typeof source.by !== 'string' || !endpoint.time?.grains.includes(source.by))) clientError('HQ_CLIENT_QUERY', '/by');
  if (source.timezone !== undefined) timezone(source.timezone, '/timezone');
  const orderBy = array(source.orderBy === undefined ? [] : source.orderBy, caps.maxOrderBy, '/orderBy');
  const orderable = [...dimensions.filter(key => endpoint.dimensions[key].orderable),
    ...selectedMeasures, ...(source.by === undefined ? [] : ['period'])];
  const ordered = new Set<string>();
  orderBy.forEach((item, index) => {
    const path = `/orderBy/${index}`;
    const order = shape(item, ['field', 'direction'], path);
    if (typeof order.field !== 'string' || !orderable.includes(order.field) || ordered.has(order.field)) clientError('HQ_CLIENT_QUERY', `${path}/field`);
    if (order.direction !== 'asc' && order.direction !== 'desc') clientError('HQ_CLIENT_QUERY', `${path}/direction`);
    ordered.add(order.field);
  });
  // HTTP clamps a larger limit; an agent is refused one, so it never reads a
  // silently shortened page as the whole answer.
  const effectiveLimit = Math.min(source.limit === undefined ? caps.defaultLimit
    : integer(source.limit, 1, transport === 'mcp' ? caps.maxLimit : Number.MAX_SAFE_INTEGER, '/limit'), caps.maxLimit);
  const offset = source.offset === undefined ? 0 : integer(source.offset, 0, caps.maxOffset, '/offset');
  if (source.includeMeta !== undefined && typeof source.includeMeta !== 'boolean') clientError('HQ_CLIENT_QUERY', '/includeMeta');
  if (source.includeMeta === true && !endpoint.metadata) clientError('HQ_CLIENT_QUERY', '/includeMeta');
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
    if (error instanceof ProtocolClientContractError) {
      // An agent names the time grain `grain`; point at the member it sent.
      const path = transport === 'mcp' && (error.path === '/by' || error.path.startsWith('/by/'))
        ? `/grain${error.path.slice(3)}` : error.path;
      clientError('HQ_CLIENT_QUERY', path);
    }
    throw error;
  }
}
