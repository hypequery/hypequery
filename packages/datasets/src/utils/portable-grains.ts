/**
 * Time grains that the published deployment contract can carry.
 *
 * `minute` and `hour` run locally, but they are expression extension 2 and
 * deployment contract 3 features (RFC 0015). Publishing emits contract 2 until
 * it can emit contract 3, so a dataset that pins a sub-day grain is refused
 * with an error naming what needs it, rather than failing later as an opaque
 * contract validation error.
 */

import type { ProtocolTimeGrain } from '@hypequery/protocol';
import type { TimeGrain } from '../types.js';

/** Grains deployment contract 2 and invocation 1 carry, in ascending order. */
export const PORTABLE_TIME_GRAINS: readonly ProtocolTimeGrain[] = Object.freeze([
  'day', 'week', 'month', 'quarter', 'year',
]);

const CONTRACT_2_GRAINS: ReadonlySet<string> = new Set(PORTABLE_TIME_GRAINS);

export function isPortableTimeGrain(grain: TimeGrain): grain is ProtocolTimeGrain {
  return CONTRACT_2_GRAINS.has(grain);
}

/** Returns `grain` when publishing can carry it; otherwise throws naming `owner`. */
export function requirePortableTimeGrain(grain: TimeGrain, owner: string): ProtocolTimeGrain {
  if (!isPortableTimeGrain(grain)) {
    throw new Error(
      `${owner} uses the "${grain}" time grain, which cannot be published yet: sub-day grains ` +
      'need deployment contract 3 (RFC 0015). Use it for local queries, or pin a grain of a day or longer.',
    );
  }
  return grain;
}

/** Contract 2 cannot represent a dataset-level restriction on portable grains. */
export function assertPublishableTimeGrains(
  dataset: { readonly name: string; readonly timeGrains?: readonly TimeGrain[] },
): void {
  if (dataset.timeGrains === undefined) return;
  const missing = PORTABLE_TIME_GRAINS.filter(grain => !dataset.timeGrains?.includes(grain));
  if (missing.length > 0) {
    throw new Error(
      `Dataset "${dataset.name}" timeGrains excludes ${missing.join(', ')}, but deployment contract 2 ` +
      'cannot preserve dataset-level grain restrictions. Use all day-through-year grains or keep this dataset local.',
    );
  }
}
