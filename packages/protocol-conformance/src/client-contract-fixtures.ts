// Fixture composition only: adapters receive complete, self-contained inputs.
// These operations never validate or repair a submitted runtime contract.
import type { EnumeratedCase } from './types.js';
type Data = Record<string, unknown>;
function base(values: Map<string, unknown>, id: unknown): Data {
  if (typeof id !== 'string' || !values.has(id)) throw new Error('Unknown client fixture base');
  return structuredClone(values.get(id)) as Data;
}
function patch(value: Data, changes: { path: string; value: unknown }[]): Data {
  for (const change of changes) {
    if (!change.path.startsWith('/')) throw new Error('Invalid client fixture pointer');
    const parts = change.path.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
    let target = value;
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(target, part)) throw new Error('Missing client fixture parent');
      target = target[part] as Data;
    }
    const key = parts.at(-1)!;
    if (key === '-' && Array.isArray(target)) target.push(structuredClone(change.value));
    else Object.defineProperty(target, key, { value: structuredClone(change.value), enumerable: true, writable: true, configurable: true });
  }
  return value;
}
export function composeClientContractCases(cases: EnumeratedCase[]): EnumeratedCase[] {
  const values = new Map(cases.filter(item => item.role === 'success' && item.case.mode === undefined)
    .map(item => [item.id, item.case.value]));
  return cases.map(item => {
    const c = item.case;
    if (c.base !== undefined) return { ...item, case: { ...c, value: patch(base(values, c.base), c.set as { path: string; value: unknown }[]) } };
    if (c.mode === 'query') return { ...item, case: { ...c, value: { contract: base(values, c.contract), endpoint: c.endpoint, input: c.input, transport: c.transport ?? 'http' } } };
    if (c.mode === 'relation') return { ...item, case: { ...c, value: c.left === undefined ? { contract: base(values, c.contract) }
      : { left: base(values, c.left), right: base(values, c.right) } } };
    if (c.mode === 'boundary') {
      const generator = c.generator as Data;
      let value: unknown;
      if (generator.type === 'endpoints') value = { ...base(values, 'build'), endpoints: Array.from({ length: generator.count as number }, () => ({})) };
      else if (generator.type === 'descriptors') {
        const dimensions = Object.fromEntries(Array.from({ length: 256 }, (_, i) => ['field' + i, null]));
        value = { ...base(values, 'build'), endpoints: Array.from({ length: generator.count as number }, () => ({ dimensions })) };
      } else if (generator.type === 'bytes') value = { extra: 'x'.repeat((generator.count as number) - 12) };
      else if (generator.type === 'depth') { value = 0; for (let i = 1; i < (generator.count as number); i++) value = [value]; }
      else throw new Error('Unknown client fixture generator');
      return { ...item, case: { ...c, value } };
    }
    return item;
  });
}
