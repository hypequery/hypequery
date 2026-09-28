import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import type { AnyDatasetInstance } from '../types.js';
import { stableStringify } from '../utils/canonical-json.js';

const LOCAL_DEFINITION_DOMAIN = 'hypequery.ts.local-definitions.v1\0';

type Relationship = { __type?: unknown; target?: unknown };

function isDataset(value: unknown): value is AnyDatasetInstance {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { __type?: unknown }).__type === 'dataset'
    && typeof (value as { name?: unknown }).name === 'string'
  );
}

function relationshipTarget(relationship: Relationship): AnyDatasetInstance | undefined {
  if (typeof relationship.target !== 'function') return undefined;
  const target = (relationship.target as () => unknown)();
  return isDataset(target) ? target : undefined;
}

/**
 * Every dataset an execution over `root` could read: the root plus everything
 * reachable through its relationships.
 */
function reachableDatasets(root: AnyDatasetInstance): AnyDatasetInstance[] {
  const found = new Map<string, AnyDatasetInstance>();
  const pending: AnyDatasetInstance[] = [root];
  while (pending.length > 0) {
    const current = pending.pop() as AnyDatasetInstance;
    if (found.has(current.name)) continue;
    found.set(current.name, current);
    for (const relationship of Object.values(current.relationships ?? {}) as Relationship[]) {
      const target = relationshipTarget(relationship);
      if (target && !found.has(target.name)) pending.push(target);
    }
  }
  return [...found.values()];
}

/**
 * A deterministic description of a definition tree. Functions contribute their
 * source text, so editing a SQL callback changes the identity. A relationship
 * target contributes its dataset name, because the target dataset is
 * described separately. Cycles are cut rather than followed.
 */
function describe(value: unknown, seen: WeakSet<object>, key?: string): unknown {
  if (typeof value === 'function') {
    if (key === 'target') {
      const target = (value as () => unknown)();
      return isDataset(target) ? { dataset: target.name } : `fn:${String(value)}`;
    }
    return `fn:${String(value)}`;
  }
  if (value instanceof Date) return { date: value.toISOString() };
  if (typeof value === 'bigint') return { bigint: value.toString() };
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[cycle]';
  seen.add(value);
  const described = Array.isArray(value)
    ? value.map((item) => describe(item, seen))
    : Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, item]) => [
          name,
          describe(item, seen, name),
        ]),
      );
  seen.delete(value);
  return described;
}

/**
 * The local definition identity RFC 0009 leaves implementation-defined: a
 * digest of every definition that could affect the rows of a query over
 * `root`, plus the metric spec and cache scope when present.
 *
 * Entries under it are never shared with released deployments or with other
 * implementations. That costs only misses, and any definition change starts
 * fresh.
 */
export function localDefinitionIdentity(
  root: AnyDatasetInstance,
  extra: { metric?: unknown; scope?: string } = {},
): string {
  const datasets = Object.fromEntries(
    reachableDatasets(root).map((dataset) => [dataset.name, describe(dataset, new WeakSet())]),
  );
  const description = stableStringify({
    datasets,
    metric: extra.metric === undefined ? null : describe(extra.metric, new WeakSet()),
    scope: extra.scope ?? null,
  });
  return bytesToHex(sha256(new TextEncoder().encode(LOCAL_DEFINITION_DOMAIN + description)));
}

/**
 * Folds a cache scope into a deployed definition identity. `scope` partitions
 * entries between data sources that share one release, so it must separate
 * keys even when the definitions are identical.
 */
export function scopedDefinitionIdentity(identity: string, scope: string | undefined): string {
  if (scope === undefined) return identity;
  const input = `hypequery.ts.cache-scope.v1\0${identity}\0${scope}`;
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}
