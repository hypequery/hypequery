import type { ProtocolDeploymentContract } from '@hypequery/protocol';
import { isTenantKeyCandidateName } from '../tenant-key-candidates.js';
import type { DiscoveredSchema, SamplePolicy } from './engine-types.js';

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
