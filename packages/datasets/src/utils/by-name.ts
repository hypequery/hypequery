/**
 * The weights a name sorts by: underscore, then digits, then letters
 * compared without case; ties then go lowercase first. This is what
 * `localeCompare` gives RFC 0002 names (ASCII letters, digits, underscores)
 * under the root collation, fixed so it cannot change with the host locale.
 * Python's `portable_name_key` is the same collation.
 */
function nameWeights(value: string): { base: number[]; caseWeights: number[] } {
  const base: number[] = [];
  const caseWeights: number[] = [];
  for (const char of value) {
    if (char === '_') {
      base.push(0);
      caseWeights.push(0);
    } else if (char >= '0' && char <= '9') {
      base.push(char.charCodeAt(0) - 48 + 1);
      caseWeights.push(0);
    } else {
      const lower = char.toLowerCase();
      base.push(lower.charCodeAt(0) - 97 + 11);
      caseWeights.push(char === lower ? 0 : 1);
    }
  }
  return { base, caseWeights };
}

function compareWeights(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}

/**
 * The order protocol artifacts list named things in, so the same definitions
 * produce the same bytes whatever order they were supplied in, on any host.
 */
export function byName<T extends { readonly name: string }>(left: T, right: T): number {
  const a = nameWeights(left.name);
  const b = nameWeights(right.name);
  return compareWeights(a.base, b.base) || compareWeights(a.caseWeights, b.caseWeights);
}
