import type { AnyDatasetInstance } from '../types.js';

export function isDatasetInstance(target: unknown): target is AnyDatasetInstance {
  return !!target && typeof target === 'object' && '__type' in target && target.__type === 'dataset';
}
