import { isBindingName } from './source-writer.js';

/**
 * The exported constant for each dataset, as `generate:datasets` names them:
 * `order_items` → `OrderItemsDataset`. Names that collide or can't be a
 * binding get a numeric suffix, so every dataset has exactly one constant.
 */
export function datasetConstantNames(names: readonly string[]): ReadonlyMap<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const name of [...names].sort()) {
    const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
    let base = `${words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('')}Dataset`;
    if (!isBindingName(base) || /^[0-9]/.test(base)) base = `Dataset${base}`;
    let candidate = base;
    for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${base}${suffix}`;
    used.add(candidate);
    result.set(name, candidate);
  }
  return result;
}
