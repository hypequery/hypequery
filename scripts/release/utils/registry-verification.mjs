// Polling and integrity rules for "did this version really reach npm?".
// The registry and its CDN can lag a fresh publish by a minute or more, so a
// missing version is retried until a deadline before it counts as a failure.

import { createHash } from 'node:crypto';

export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Delay before retry number `attempt` (1-based): 10s, 15s, 20s … capped at 30s. */
export function retryDelayMs(attempt) {
  return Math.min(10_000 + (attempt - 1) * 5_000, 30_000);
}

/**
 * True when `bytes` match an npm `dist.integrity` value. npm writes one or more
 * space-separated `<algorithm>-<base64>` entries; any matching sha512/sha384/
 * sha256/sha1 entry is enough, as in the SRI spec.
 */
export function integrityMatches(bytes, integrity) {
  if (typeof integrity !== 'string' || integrity.trim() === '') return false;
  for (const entry of integrity.trim().split(/\s+/)) {
    const separator = entry.indexOf('-');
    if (separator <= 0) continue;
    const algorithm = entry.slice(0, separator);
    if (!['sha512', 'sha384', 'sha256', 'sha1'].includes(algorithm)) continue;
    const expected = entry.slice(separator + 1).split('?')[0];
    if (createHash(algorithm).update(bytes).digest('base64') === expected) return true;
  }
  return false;
}

/**
 * Resolves `promise`, or `{ ok: false, reason }` once `signal` aborts, so a
 * check that ignores its signal still cannot outlive the budget.
 */
export function settleWithinBudget(promise, signal, reason) {
  if (signal.aborted) return Promise.resolve({ ok: false, reason });
  return new Promise((resolve) => {
    const onAbort = () => resolve({ ok: false, reason });
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (result) => { signal.removeEventListener('abort', onAbort); resolve(result); },
      (error) => { signal.removeEventListener('abort', onAbort); resolve({ ok: false, reason: error.message }); },
    );
  });
}

/**
 * Check every item until each passes or the budget runs out. `check(item,
 * { signal, timeoutMs })` resolves `{ ok: true }` or `{ ok: false, reason }`;
 * it gets the remaining budget so it can stop its own child processes and
 * downloads, and an attempt still in flight when the budget ends counts as a
 * failure. Returns the items that never passed, each with its last reason.
 * `sleep` and `now` are injectable so tests can skip the waits.
 */
export async function pollUntilVerified(items, check, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  onAttempt = () => {},
} = {}) {
  const deadline = now() + timeoutMs;
  let pending = items.map((item) => ({ item, reason: 'not checked' }));
  for (let attempt = 1; pending.length > 0; attempt += 1) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    // A ref'd timer, unlike AbortSignal.timeout, keeps the process alive
    // until the budget ends even if a check is waiting on nothing.
    const budget = new AbortController();
    const budgetTimer = setTimeout(() => budget.abort(), remainingMs);
    const { signal } = budget;
    const timedOut = `still running when the ${Math.round(timeoutMs / 1000)}s budget ran out`;
    const results = await Promise.all(pending.map(async (entry) => {
      let attemptResult;
      try {
        attemptResult = check(entry.item, { signal, timeoutMs: remainingMs });
      } catch (error) {
        attemptResult = Promise.reject(error);
      }
      return { ...entry, result: await settleWithinBudget(Promise.resolve(attemptResult), signal, timedOut) };
    }));
    clearTimeout(budgetTimer);
    pending = results
      .filter(({ result }) => !result.ok)
      .map(({ item, result }) => ({ item, reason: result.reason ?? 'unknown failure' }));
    onAttempt({ attempt, pending });
    if (pending.length === 0 || signal.aborted) break;
    const delay = retryDelayMs(attempt);
    if (now() + delay > deadline) break;
    await sleep(delay);
  }
  return pending;
}
