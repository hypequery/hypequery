/**
 * Time grains that the published deployment contract can carry.
 *
 * Contract 2 carries `day` through `year`. Contract 3 (RFC 0015) adds `minute`
 * and `hour`, and the portable runtime accepts them in a query's `by` through
 * semantic invocation 2. Metrics and the standalone dataset contract stay on
 * the contract 2 registry.
 */

import type { ProtocolQueryTimeGrain, ProtocolTimeGrain } from '@hypequery/protocol';
import { SUPPORTED_TIME_GRAINS } from '../constants.js';
import type { TimeGrain } from '../types.js';

/** Grains deployment contract 2 and invocation 1 carry, in ascending order. */
export const PORTABLE_TIME_GRAINS: readonly ProtocolTimeGrain[] = Object.freeze([
  'day', 'week', 'month', 'quarter', 'year',
]);

/**
 * Grains a rebuilt dataset accepts: every grain the planner can bucket on.
 * Invocation 1 still refuses `minute` and `hour` before they reach it.
 */
export const PUBLISHED_TIME_GRAINS: readonly ProtocolQueryTimeGrain[] = Object.freeze([
  ...SUPPORTED_TIME_GRAINS,
] as ProtocolQueryTimeGrain[]);

const CONTRACT_2_GRAINS: ReadonlySet<string> = new Set(PORTABLE_TIME_GRAINS);

export function isPortableTimeGrain(grain: TimeGrain): grain is ProtocolTimeGrain {
  return CONTRACT_2_GRAINS.has(grain);
}

export function isSubDayTimeGrain(grain: TimeGrain): boolean {
  return grain === 'minute' || grain === 'hour';
}

/** Returns `grain` when contract 2 can carry it; otherwise throws naming `owner`. */
export function requirePortableTimeGrain(grain: TimeGrain, owner: string): ProtocolTimeGrain {
  if (!isPortableTimeGrain(grain)) {
    throw new Error(
      `${owner} uses the "${grain}" time grain, which cannot be published here: sub-day grains ` +
      'need deployment contract 3 (RFC 0015). Use it for local queries, or pin a grain of a day or longer.',
    );
  }
  return grain;
}

/**
 * No deployment contract carries a dataset-level grain restriction, and a
 * published dataset accepts every grain. Publishing a restriction would
 * silently widen it, so a dataset must either declare none or list them all.
 */
export function assertPublishableTimeGrains(
  dataset: { readonly name: string; readonly timeGrains?: readonly TimeGrain[] },
): void {
  if (dataset.timeGrains === undefined) return;
  const missing = SUPPORTED_TIME_GRAINS.filter(grain => !dataset.timeGrains?.includes(grain));
  if (missing.length > 0) {
    throw new Error(
      `Dataset "${dataset.name}" timeGrains excludes ${missing.join(', ')}, but deployment contracts ` +
      'cannot preserve dataset-level grain restrictions, and a published dataset accepts every grain. ' +
      'Remove timeGrains to publish it, or keep this dataset local.',
    );
  }
}
