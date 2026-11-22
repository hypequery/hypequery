// Canary staleness rule: the canary dist-tag must not trail the newest main
// commit that touched a published package by more than the threshold.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_THRESHOLD_DAYS = 3;

/**
 * `canaryTime` and `commitTime` are ISO strings (or null when unknown). A
 * missing canary or publish time is always stale: nothing proves it is fresh.
 */
export function evaluateCanaryStaleness({ canaryTime, commitTime, thresholdDays = DEFAULT_THRESHOLD_DAYS }) {
  const commitMs = Date.parse(commitTime);
  if (Number.isNaN(commitMs)) throw new Error(`Invalid commit time: ${commitTime}`);
  const canaryMs = canaryTime ? Date.parse(canaryTime) : Number.NaN;
  if (Number.isNaN(canaryMs)) {
    return { stale: true, lagDays: Number.POSITIVE_INFINITY, reason: 'canary dist-tag or its publish time is missing' };
  }
  const lagDays = Math.max(0, commitMs - canaryMs) / DAY_MS;
  return {
    stale: lagDays > thresholdDays,
    lagDays,
    reason: lagDays > thresholdDays ? `canary trails main by ${lagDays.toFixed(1)} days` : 'fresh',
  };
}
