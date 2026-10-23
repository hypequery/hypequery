import { parseProtocolIdentifier } from '../identifiers/index.js';
import { deploymentError } from './errors.js';
import type { ProtocolIdentifier } from '../identifiers/index.js';
import type { ProtocolRowResolution } from './types.js';

/** Validate separately so code-first models use exactly the contract grammar. */
export function validateProtocolRowResolution(input: unknown, path = '$.rowResolution'): ProtocolRowResolution {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) deploymentError('HQ_DEPLOYMENT_TYPE', path);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
  const value = input as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor || !('value' in descriptor)) deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
  }
  for (const key of ['kind', 'engine']) if (!Object.hasOwn(value, key)) deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.${key}`);
  if (value.kind !== 'final') deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.kind`);
  const engine = value.engine;
  if (engine !== 'replacing' && engine !== 'collapsing' && engine !== 'versioned-collapsing') deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.engine`);
  const columnKey = engine === 'replacing' ? 'deletedColumn' : 'signColumn';
  for (const key of Object.getOwnPropertyNames(value)) if (!['kind', 'engine', columnKey].includes(key)) deploymentError('HQ_DEPLOYMENT_UNKNOWN_FIELD', `${path}.${key}`);
  let column: ProtocolIdentifier | undefined;
  if (value[columnKey] !== undefined) {
    try { column = parseProtocolIdentifier(value[columnKey]); }
    catch { deploymentError('HQ_DEPLOYMENT_INVALID_IDENTIFIER', `${path}.${columnKey}`); }
  }
  if (engine === 'replacing') return Object.freeze({ kind: 'final', engine, ...(column === undefined ? {} : { deletedColumn: column }) });
  if (column === undefined) deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.signColumn`);
  return Object.freeze({ kind: 'final', engine, signColumn: column });
}
