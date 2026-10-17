import { clientError, ProtocolClientContractError } from './errors.js';
import { serializeJcs } from '../values/jcs.js';

export const CLIENT_MAX_BYTES = 1_048_576;
const encoder = new TextEncoder();
interface Budget { nodes: number; bytes: number; active: WeakSet<object> }
function charge(budget: Budget, bytes: number): void {
  budget.bytes += bytes;
  if (budget.bytes > CLIENT_MAX_BYTES) clientError('HQ_CLIENT_LIMIT');
}
function text(value: string, budget: Budget): void {
  if (value.length > CLIENT_MAX_BYTES) clientError('HQ_CLIENT_LIMIT');
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code >= 0xD800 && code <= 0xDFFF) clientError('HQ_CLIENT_TYPE');
  }
  charge(budget, encoder.encode(JSON.stringify(value)).byteLength);
}
function copy(input: unknown, budget: Budget, depth: number): unknown {
  if (depth > 16 || ++budget.nodes > 100_000) clientError('HQ_CLIENT_LIMIT');
  if (typeof input === 'string') { text(input, budget); return input; }
  if (input === null || typeof input === 'boolean' || typeof input === 'number') {
    if (typeof input === 'number' && !Number.isFinite(input)) clientError('HQ_CLIENT_TYPE');
    charge(budget, encoder.encode(JSON.stringify(input)).byteLength);
    return input;
  }
  if (typeof input !== 'object') clientError('HQ_CLIENT_TYPE');
  if (budget.active.has(input)) clientError('HQ_CLIENT_TYPE');
  budget.active.add(input);
  try {
    const array = Array.isArray(input);
    let prototype: unknown;
    let keys: (string | symbol)[];
    try {
      prototype = Object.getPrototypeOf(input);
      keys = Reflect.ownKeys(input);
    } catch { clientError('HQ_CLIENT_TYPE'); }
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      clientError('HQ_CLIENT_TYPE');
    }
    if (keys.length > 20_000 + (array ? 1 : 0)) clientError('HQ_CLIENT_LIMIT');
    if (keys.some(key => typeof key !== 'string')) clientError('HQ_CLIENT_TYPE');
    const descriptors: PropertyDescriptorMap = Object.create(null);
    for (const key of keys as string[]) {
      let descriptor: PropertyDescriptor | undefined;
      try { descriptor = Object.getOwnPropertyDescriptor(input, key); }
      catch { clientError('HQ_CLIENT_TYPE'); }
      if (!descriptor) clientError('HQ_CLIENT_TYPE');
      descriptors[key] = descriptor;
    }
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length > 20_000) clientError('HQ_CLIENT_LIMIT');
      if (keys.length !== length + 1) clientError('HQ_CLIENT_TYPE');
      charge(budget, Math.max(length - 1, 0) + 2);
      const result: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const item = descriptors[String(i)];
        if (!item || !item.enumerable || !('value' in item)) clientError('HQ_CLIENT_TYPE');
        result.push(copy(item.value, budget, depth + 1));
      }
      return result;
    }
    charge(budget, keys.length + Math.max(keys.length - 1, 0) + 2);
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const item = descriptors[key];
      if (!item.enumerable || !('value' in item)) clientError('HQ_CLIENT_TYPE');
      text(key, budget);
      result[key] = copy(item.value, budget, depth + 1);
    }
    return result;
  } finally { budget.active.delete(input); }
}
/** Snapshot before validation; accessors/toJSON are never invoked. Reflection can trigger Proxy traps. */
export function snapshotClientData(input: unknown): unknown {
  try { return copy(input, { nodes: 0, bytes: 0, active: new WeakSet() }, 1); }
  catch (error) {
    if (error instanceof ProtocolClientContractError) throw error;
    clientError('HQ_CLIENT_TYPE');
  }
}
export function clientCanonical(value: unknown): string {
  const canonical = serializeJcs(value);
  if (encoder.encode(canonical).byteLength > CLIENT_MAX_BYTES) clientError('HQ_CLIENT_LIMIT');
  return canonical;
}
export function freezeClientData<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeClientData(child);
    Object.freeze(value);
  }
  return value;
}
