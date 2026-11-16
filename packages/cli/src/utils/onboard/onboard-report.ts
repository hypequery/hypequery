import type { ProtocolDeploymentContract } from '@hypequery/protocol';
import { isTenantKeyCandidateName } from '../tenant-key-candidates.js';
import type { DiscoveredSchema, JoinKey, JoinSplit, SamplePolicy } from './engine-types.js';

/**
 * Report helpers. Everything `--json` prints may be read by a coding agent and
 * its model provider, so reports cross the engine's provider boundary: proof
 * SQL with result rows and example rows stay out (the engine marks them
 * customer-only), and sampled values follow the sample policy.
 */

/** Fields the engine marks customer-only: measured proof, example rows and member decisions. */
const CUSTOMER_ONLY = ['proof', 'examples', 'fanOutProof', 'decision'] as const;

export function withoutCustomerOnly<T extends object>(value: T): T {
  const copy = { ...value } as Record<string, unknown>;
  for (const key of CUSTOMER_ONLY) delete copy[key];
  return copy as T;
}

/**
 * A join check or candidate with its split as a report may carry it. Each
 * split group's `value` is a value of the split column, which the engine marks
 * customer data unless the column's type declares it (Enum, Bool). It follows
 * the sample policy like any sampled value: when `valuesShown` says the
 * column's samples are withheld, the groups keep their counts and lose their
 * values, and the split says so with `valuesWithheld`.
 *
 * The engine also writes the matching values into the candidate's `reason`
 * ("... only where orders.region is emea or apac; ..."), so with the values
 * withheld the reason is rebuilt without them.
 */
export function withPolicySplit<T extends { readonly split?: JoinSplit; readonly reason?: string; readonly child?: JoinKey; readonly parent?: JoinKey }>(
  value: T,
  valuesShown: (table: string, column: string) => boolean,
): T {
  const split = value.split;
  if (!split || valuesShown(split.table, split.column)) return value;
  return {
    ...value,
    ...(typeof value.reason === 'string' ? { reason: withheldSplitReason(value, split) } : {}),
    split: {
      ...split,
      groups: split.groups.map(group => ({ childRows: group.childRows, matchedRows: group.matchedRows })),
      valuesWithheld: true,
    },
  };
}

/** The engine's split reason without the split column's values. */
function withheldSplitReason(value: { readonly child?: JoinKey; readonly parent?: JoinKey }, split: JoinSplit): string {
  const join = value.child && value.parent
    ? `${value.child.table}.${value.child.column} matches ${value.parent.table}.${value.parent.column}`
    : 'The join matches';
  return `${join} only for some values of ${split.table}.${split.column} (values withheld by the sample policy); other rows don't match. `
    + 'Whether to join for those rows is a question for the user.';
}

/**
 * A partition ID is built from the partition key's values (a tenant ID when a
 * table is partitioned by tenant), so it follows the sample policy too: it is
 * shown only when every column the partition key names may show its samples.
 * It is withheld under `--samples none`, and under `detected` when the key
 * names no column of the table; `--samples all` shows it.
 */
export function partitionIdShown(
  schema: DiscoveredSchema,
  mode: SampleMode,
  withheld: (table: string, column: string) => boolean,
): (table: string) => boolean {
  return (name) => {
    if (mode === 'all') return true;
    if (mode === 'none') return false;
    const table = schema.tables.find(item => item.name === name);
    const key = typeof table?.partitionKey === 'string' ? table.partitionKey : '';
    const identifiers = new Set(key.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
    const columns = (table?.columns ?? []).filter(column => identifiers.has(column.name));
    return columns.length > 0 && columns.every(column => !withheld(name, column.name));
  };
}

/**
 * A table, grain check or join with its partition ID removed when `shown`
 * says so: the table's `recentPartitionId` and a sample scope's `partitionId`.
 */
export function withPolicyPartition<T extends object>(value: T, table: string | undefined, shown: (table: string) => boolean): T {
  if (table === undefined || shown(table)) return value;
  const copy = { ...value } as Record<string, unknown>;
  const hadPartition = 'recentPartitionId' in copy;
  delete copy.recentPartitionId;
  if (hadPartition) copy.recentPartitionWithheld = true;
  const scope = copy.scope;
  if (scope && typeof scope === 'object' && 'partitionId' in scope) {
    const { partitionId: _partitionId, ...rest } = scope as Record<string, unknown>;
    void _partitionId;
    copy.scope = { ...rest, partitionWithheld: true };
  }
  return copy as T;
}

/** A contract with no datasets: column role hints before any model exists. */
export const EMPTY_CONTRACT = { kind: 'hypequery-deployment', version: 2, datasets: [] } as unknown as ProtocolDeploymentContract;

export const SAMPLE_MODES = ['detected', 'none', 'all'] as const;
export type SampleMode = typeof SAMPLE_MODES[number];

export function samplePolicy(mode: SampleMode): SamplePolicy {
  return { mode, overrides: [] };
}

/** A warning in a report: the command still succeeded. */
export interface OnboardWarning {
  readonly code: string;
  readonly message: string;
  readonly hint?: string;
}

export interface TenantKeyCandidate {
  readonly table: string;
  readonly column: string;
}

/**
 * Columns whose names suggest a tenant boundary, to ask the user about. Never
 * applied: `tenantKey` is a security boundary only the user can name.
 */
export function tenantKeyCandidates(schema: DiscoveredSchema): TenantKeyCandidate[] {
  return schema.tables.flatMap(table => table.columns
    .filter(column => column.supported && isTenantKeyCandidateName(column.name))
    .map(column => ({ table: table.name, column: column.name })));
}

/** Supported tables to analyse: `--tables` when given (unknown names are reported), otherwise all. */
export function selectTables(schema: DiscoveredSchema, requested: readonly string[] | undefined): { tables: string[]; unknown: string[] } {
  const supported = schema.tables.filter(table => table.supported).map(table => table.name);
  if (!requested?.length) return { tables: supported, unknown: [] };
  return {
    tables: requested.filter(name => supported.includes(name)),
    unknown: requested.filter(name => !supported.includes(name)),
  };
}

export function parseList(value: string | undefined): string[] | undefined {
  const list = value?.split(',').map(item => item.trim()).filter(Boolean);
  return list?.length ? list : undefined;
}
