import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import type { AnyDatasetInstance, FormulaExpr } from '../types.js';
import { stableStringify } from '../utils/canonical-json.js';

const LOCAL_DEFINITION_DOMAIN = 'hypequery.ts.local-definitions.v2\0';

/**
 * Library-created methods, by the `__type` of the object that carries them.
 * They read only state that is described alongside them, so they contribute
 * nothing of their own.
 */
const LIBRARY_METHODS: Readonly<Record<string, readonly string[]>> = {
  dataset: ['metric'],
  metric_ref: ['by', 'contract'],
  grained_metric_ref: ['contract'],
};

type Owner = { __type?: unknown; uses?: unknown; formula?: unknown };

function isDataset(value: unknown): value is AnyDatasetInstance {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { __type?: unknown }).__type === 'dataset'
    && typeof (value as { name?: unknown }).name === 'string'
  );
}

function isFormulaExpr(value: unknown): value is FormulaExpr {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { __type?: unknown }).__type === 'formula_expr'
    && typeof (value as { toSQL?: unknown }).toSQL === 'function'
  );
}

/**
 * The formula's own SQL, which derived metrics execute. `null` when it throws:
 * derived measures compile the expression instead, so it need not render.
 */
function formulaSql(formula: FormulaExpr): string | null {
  try {
    return formula.toSQL();
  } catch {
    return null;
  }
}

function undescribable(key: string | undefined): never {
  throw new Error(
    `Cannot derive a local definition identity: the function at "${key ?? '?'}" `
      + 'is not a formula, relationship target, or library method.',
  );
}

/**
 * Builds a deterministic description of every definition a query over a root
 * dataset could read.
 *
 * A function never contributes its source text: that omits the values it
 * captures, so `make(2)` and `make(3)` over `({ r }) => round(r, digits)`
 * would collide. Instead:
 * - a formula is evaluated, and its resolved expression and SQL are described;
 * - a relationship target contributes its dataset's name, and that dataset is
 *   described separately;
 * - a known library method contributes nothing.
 *
 * Any other function throws, so the caller runs the query uncached rather
 * than risk serving another definition's rows.
 */
class DefinitionDescriber {
  private readonly found = new Map<string, AnyDatasetInstance>();
  private readonly pending: AnyDatasetInstance[] = [];

  /** Queues a dataset for description and stands in for it by name. */
  reference(dataset: AnyDatasetInstance): { dataset: string } {
    if (!this.found.has(dataset.name)) {
      this.found.set(dataset.name, dataset);
      this.pending.push(dataset);
    }
    return { dataset: dataset.name };
  }

  /** Describes every queued dataset, including those queued along the way. */
  describeDatasets(): Record<string, unknown> {
    const described: Record<string, unknown> = {};
    while (this.pending.length > 0) {
      const dataset = this.pending.pop() as AnyDatasetInstance;
      described[dataset.name] = this.describeFields(dataset, new WeakSet());
    }
    return described;
  }

  describe(value: unknown, seen: WeakSet<object>, owner?: Owner, key?: string): unknown {
    if (typeof value === 'function') return this.describeFunction(value, seen, owner, key);
    if (value instanceof Date) return { date: value.toISOString() };
    if (typeof value === 'bigint') return { bigint: value.toString() };
    if (typeof value !== 'object' || value === null) return value;
    if (isDataset(value)) return this.reference(value);
    return this.describeFields(value, seen);
  }

  private describeFields(value: object, seen: WeakSet<object>): unknown {
    if (seen.has(value)) return '[cycle]';
    seen.add(value);
    const described = Array.isArray(value)
      ? value.map((item) => this.describe(item, seen))
      : Object.fromEntries(
          Object.entries(value).map(([name, item]) => [
            name,
            this.describe(item, seen, value as Owner, name),
          ]),
        );
    seen.delete(value);
    return described;
  }

  private describeFunction(
    fn: unknown,
    seen: WeakSet<object>,
    owner: Owner | undefined,
    key: string | undefined,
  ): unknown {
    if (key === 'target') {
      const target = (fn as () => unknown)();
      return isDataset(target) ? this.reference(target) : undescribable(key);
    }
    if (key === 'formula' && owner && typeof owner.uses === 'object' && owner.uses !== null) {
      // The same identity aliases the planner and validation evaluate with.
      const aliases = Object.fromEntries(Object.keys(owner.uses).map((alias) => [alias, alias]));
      const result = (fn as (inputs: Record<string, string>) => unknown)(aliases);
      if (!isFormulaExpr(result)) return undescribable(key);
      return { expression: this.describe(result.expression, seen), sql: formulaSql(result) };
    }
    const type = typeof owner?.__type === 'string' ? owner.__type : undefined;
    if (type !== undefined && key !== undefined && LIBRARY_METHODS[type]?.includes(key)) {
      return 'method';
    }
    return undescribable(key);
  }
}

/**
 * The local definition identity RFC 0009 leaves implementation-defined: a
 * digest of every definition that could affect the rows of a query over
 * `root`, plus the metric spec, cache scope, and timezone when present.
 *
 * Throws when a definition holds a function it cannot describe safely; the
 * caller then runs the query uncached.
 *
 * Entries under it are never shared with released deployments or with other
 * implementations. That costs only misses, and any definition change starts
 * fresh.
 */
export function localDefinitionIdentity(
  root: AnyDatasetInstance,
  extra: { metric?: unknown; scope?: string; timezone?: string } = {},
): string {
  const describer = new DefinitionDescriber();
  describer.reference(root);
  const metric = extra.metric === undefined ? null : describer.describe(extra.metric, new WeakSet());
  const description = stableStringify({
    datasets: describer.describeDatasets(),
    metric,
    scope: extra.scope ?? null,
    timezone: extra.timezone ?? null,
  });
  return bytesToHex(sha256(new TextEncoder().encode(LOCAL_DEFINITION_DOMAIN + description)));
}

function foldPartition(identity: string, domain: string, value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${domain}\0${identity}\0${value}`)));
}

/**
 * Folds a cache scope and a non-default timezone into a deployed definition
 * identity. Both change the rows one release returns (`scope` picks the data
 * source, the timezone moves bucket boundaries), so they must separate keys
 * even when the definitions are identical.
 */
export function scopedDefinitionIdentity(
  identity: string,
  scope: string | undefined,
  timezone?: string,
): string {
  let folded = identity;
  if (scope !== undefined) folded = foldPartition(folded, 'hypequery.ts.cache-scope.v1', scope);
  if (timezone !== undefined) folded = foldPartition(folded, 'hypequery.ts.cache-timezone.v1', timezone);
  return folded;
}
