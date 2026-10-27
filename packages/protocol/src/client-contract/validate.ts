import { boundClientDescriptors } from './bounds.js';
import { clientError } from './errors.js';
import { CLIENT_CONTRACT_DOMAIN, CLIENT_SCHEMA_DOMAIN, clientDigest } from './codec.js';
import { bool, choice, name, names, pointer, record, route, shape } from './primitives.js';
import { annotations, dimension, fields, filter, limits, measure, time } from './nodes.js';
import { clientCanonical, freezeClientData, snapshotClientData } from './safe-data.js';
import type { PreparedProtocolClientContract, ProtocolClientContract, ProtocolClientEndpoint } from './types.js';

const ENDPOINT_FIELDS = ['id', 'kind', 'dataset', 'path', 'dimensions', 'measures', 'filters',
  'time', 'metadata', 'limits'];
function endpoint(input: unknown, path: string, signed: boolean): Record<string, unknown> {
  const raw = record(input, path);
  const kind = choice(raw.kind, ['dataset', 'metric'], pointer(path, 'kind'));
  const annotated = Object.hasOwn(raw, 'annotations');
  const value = shape(raw, [...ENDPOINT_FIELDS, ...(kind === 'dataset' ? ['defaultMeasures'] : []),
    ...(annotated ? ['annotations'] : []), ...(signed ? ['schemaHash'] : [])], path);
  const id = name(value.id, pointer(path, 'id'));
  const dataset = name(value.dataset, pointer(path, 'dataset'));
  const result: Record<string, unknown> = {
    id, kind, dataset, path: route(value.path, pointer(path, 'path')),
    dimensions: fields(value.dimensions, pointer(path, 'dimensions'), dimension),
    measures: fields(value.measures, pointer(path, 'measures'), measure),
    filters: fields(value.filters, pointer(path, 'filters'), filter),
    time: time(value.time, pointer(path, 'time')),
    metadata: bool(value.metadata, pointer(path, 'metadata')),
    limits: limits(value.limits, pointer(path, 'limits')),
  };
  if (kind === 'dataset') result.defaultMeasures = names(value.defaultMeasures, pointer(path, 'defaultMeasures'));
  if (annotated) result.annotations = annotations(value.annotations, pointer(path, 'annotations'));
  if (signed) result.schemaHash = value.schemaHash;
  return result;
}
function references(value: Record<string, unknown>, path: string): void {
  const item = value as unknown as ProtocolClientEndpoint;
  if ((item.kind === 'dataset') !== (item.id === item.dataset)) clientError('HQ_CLIENT_REFERENCE', path);
  if (item.kind === 'metric' && (Object.keys(item.measures).length !== 1
    || Object.values(item.measures).some(m => m.having))) clientError('HQ_CLIENT_SHAPE', path);
  for (const [key, field] of Object.entries(item.dimensions)) {
    if (key.includes('.') && field.nullable !== true) clientError('HQ_CLIENT_SHAPE', pointer(pointer(path, 'dimensions'), key));
  }
  if (Object.keys(item.dimensions).some(key => Object.hasOwn(item.measures, key))
    || (item.time !== null && (Object.hasOwn(item.dimensions, 'period') || Object.hasOwn(item.measures, 'period')))) {
    clientError('HQ_CLIENT_REFERENCE', path);
  }
  const defaults = item.kind === 'dataset' ? item.defaultMeasures : Object.keys(item.measures);
  if (defaults.some(key => !Object.hasOwn(item.measures, key))
    || defaults.length > item.limits.maxMeasures || item.limits.defaultLimit > item.limits.maxLimit) {
    clientError('HQ_CLIENT_REFERENCE', path);
  }
  if (Object.keys(item.annotations?.fields ?? {}).some(key => !Object.hasOwn(item.dimensions, key)
    && !Object.hasOwn(item.measures, key))) clientError('HQ_CLIENT_REFERENCE', path);
}
function contract(input: unknown, signed: boolean): PreparedProtocolClientContract {
  const raw = record(snapshotClientData(input), '');
  boundClientDescriptors(raw);
  if (raw.kind !== 'hypequery-client-contract' || raw.version !== 1) clientError('HQ_CLIENT_VERSION');
  const root = shape(raw, ['kind', 'version', 'view', 'endpoints', ...(signed ? ['contentHash'] : [])], '');
  const view = choice(root.view, ['build', 'authorized'], '/view');
  if (!Array.isArray(root.endpoints)) clientError('HQ_CLIENT_SHAPE', '/endpoints');
  if (root.endpoints.length > 256) clientError('HQ_CLIENT_LIMIT', '/endpoints');
  const endpoints = root.endpoints.map((item, index) => endpoint(item, '/endpoints/' + index, signed));
  const ids = new Set<unknown>(), paths = new Set<unknown>();
  for (const [index, item] of endpoints.entries()) {
    const path = '/endpoints/' + index;
    if (ids.has(item.id) || paths.has(item.path)) clientError('HQ_CLIENT_DUPLICATE', path);
    ids.add(item.id); paths.add(item.path);
  }
  endpoints.forEach((item, index) => references(item, '/endpoints/' + index));
  endpoints.sort((a, b) => (a.id as string) < (b.id as string) ? -1 : (a.id as string) > (b.id as string) ? 1 : 0);
  for (const [index, item] of endpoints.entries()) {
    const { schemaHash, limits: _limits, annotations: _annotations, ...schema } = item;
    const hash = clientDigest(CLIENT_SCHEMA_DOMAIN, schema);
    if (signed && schemaHash !== hash) clientError('HQ_CLIENT_IDENTITY', '/endpoints/' + index + '/schemaHash');
    item.schemaHash = hash;
  }
  const body = { kind: 'hypequery-client-contract', version: 1, view, endpoints };
  const contentHash = clientDigest(CLIENT_CONTRACT_DOMAIN, body);
  if (signed && root.contentHash !== contentHash) clientError('HQ_CLIENT_IDENTITY', '/contentHash');
  const result = freezeClientData({ ...body, contentHash }) as unknown as ProtocolClientContract;
  return { contract: result, canonical: clientCanonical(result), contentHash };
}
/** Validate and snapshot a signed contract. No caller object is retained. */
export function validateProtocolClientContract(input: unknown): ProtocolClientContract {
  return contract(input, true).contract;
}
/** Prepare an unsigned contract. Supplied hash fields are refused rather than overwritten. */
export function prepareProtocolClientContract(input: unknown): PreparedProtocolClientContract {
  return contract(input, false);
}
