import type { OperationsSpec, SpecOperation } from './render.ts';

export type SpecDiff = {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  /** Error codes added, removed or changed in the catalog, and category list changes. */
  readonly errors: readonly string[];
  /** Top-level fields (kind, version, basePath) that differ. */
  readonly header: readonly string[];
};

/** Key-order-independent JSON, so formatting and key order never count as drift. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function byName(operations: readonly SpecOperation[]): Map<string, SpecOperation> {
  return new Map(operations.map((operation) => [operation.name, operation]));
}

/** What changed from `current` (this repo's copy) to `next` (Cloud's). */
export function diffSpecs(current: OperationsSpec, next: OperationsSpec): SpecDiff {
  const before = byName(current.operations);
  const after = byName(next.operations);
  const added = [...after.keys()].filter((name) => !before.has(name));
  const removed = [...before.keys()].filter((name) => !after.has(name));
  const changed = [...after.keys()].filter(
    (name) => before.has(name) && canonicalJson(before.get(name)) !== canonicalJson(after.get(name)),
  );
  const errorCodes = new Set([...Object.keys(current.errors), ...Object.keys(next.errors)]);
  const errors = [...errorCodes]
    .filter((code) => canonicalJson(current.errors[code]) !== canonicalJson(next.errors[code]))
    .sort();
  if (canonicalJson(current.errorCategories) !== canonicalJson(next.errorCategories)) {
    errors.push('(errorCategories)');
  }
  const header = (['kind', 'version', 'basePath'] as const).filter((key) => current[key] !== next[key]);
  // Order is part of the spec (it orders the generated client), so a reorder alone is drift too.
  if (
    added.length + removed.length + changed.length === 0 &&
    canonicalJson(current.operations.map((o) => o.name)) !== canonicalJson(next.operations.map((o) => o.name))
  ) {
    changed.push('(operation order)');
  }
  return { added, removed, changed, errors, header };
}

export function isEmptyDiff(diff: SpecDiff): boolean {
  return (
    diff.added.length + diff.removed.length + diff.changed.length + diff.errors.length + diff.header.length === 0
  );
}

export function formatDiff(diff: SpecDiff): string {
  const lines: string[] = [];
  const section = (label: string, items: readonly string[]) => {
    if (items.length) lines.push(`${label}:`, ...items.map((item) => `  ${item}`));
  };
  section('Changed spec fields', diff.header);
  section('Added operations', diff.added);
  section('Removed operations', diff.removed);
  section('Changed operations', diff.changed);
  section('Changed error codes', diff.errors);
  return lines.join('\n');
}
