import { valueError } from './errors.js';
import type { CanonicalValueLimits } from './types.js';

interface SnapshotState {
  readonly limits: Readonly<CanonicalValueLimits>;
  readonly active: WeakSet<object>;
  nodes: number;
}

function incrementNodes(state: SnapshotState, path: string): void {
  state.nodes += 1;
  // Structural tag fields add overhead beyond logical value nodes. This guard
  // prevents unbounded allocation before exact logical validation runs.
  if (state.nodes > state.limits.maxNodes * 16) {
    valueError('HQ_VALUE_TOO_MANY_NODES', path);
  }
}

function snapshotArray(
  input: readonly unknown[],
  state: SnapshotState,
  path: string,
  syntaxDepth: number,
): unknown[] {
  const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  const ownKeys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = descriptors.length;

  if (!lengthDescriptor || typeof lengthDescriptor.value !== 'number') {
    valueError('HQ_VALUE_UNSAFE_OBJECT', path);
  }

  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > state.limits.maxNodes * 2) {
    valueError('HQ_VALUE_TOO_MANY_NODES', path);
  }

  for (const key of ownKeys) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)) {
      valueError('HQ_VALUE_UNSAFE_OBJECT', path);
    }
  }

  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      valueError('HQ_VALUE_INVALID_FORMAT', `${path}[${index}]`);
    }
    result.push(snapshotUnknown(
      descriptor.value,
      state,
      `${path}[${index}]`,
      syntaxDepth + 1,
    ));
  }

  return result;
}

function snapshotObject(
  input: object,
  state: SnapshotState,
  path: string,
  syntaxDepth: number,
): Record<string, unknown> {
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    valueError('HQ_VALUE_UNSAFE_OBJECT', path);
  }

  const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') {
      valueError('HQ_VALUE_UNSAFE_OBJECT', path);
    }
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      valueError('HQ_VALUE_UNSAFE_OBJECT', `${path}.${key}`);
    }
    Object.defineProperty(result, key, {
      value: snapshotUnknown(
        descriptor.value,
        state,
        `${path}.${key}`,
        syntaxDepth + 1,
      ),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }

  return result;
}

function snapshotUnknown(
  input: unknown,
  state: SnapshotState,
  path: string,
  syntaxDepth: number,
): unknown {
  incrementNodes(state, path);

  if (syntaxDepth > state.limits.maxDepth * 4 + 8) {
    valueError('HQ_VALUE_TOO_DEEP', path);
  }

  if (
    input === null
    || typeof input === 'boolean'
    || typeof input === 'string'
    || typeof input === 'number'
  ) {
    return input;
  }

  if (typeof input !== 'object') {
    valueError('HQ_VALUE_UNSAFE_OBJECT', path);
  }

  if (state.active.has(input)) {
    valueError('HQ_VALUE_INVALID_FORMAT', path);
  }
  state.active.add(input);

  try {
    if (Array.isArray(input)) {
      return snapshotArray(input, state, path, syntaxDepth);
    }
    return snapshotObject(input, state, path, syntaxDepth);
  } finally {
    state.active.delete(input);
  }
}

export function snapshotPlainData(
  input: unknown,
  limits: Readonly<CanonicalValueLimits>,
): unknown {
  return snapshotUnknown(input, {
    limits,
    active: new WeakSet<object>(),
    nodes: 0,
  }, '$', 0);
}
