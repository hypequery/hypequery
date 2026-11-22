import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  changedReportDirs,
  consumerBreakingValue,
  findUndeclaredApiChanges,
  parseChangeset,
} from './api-changesets.mjs';
import { DAY_MS, evaluateCanaryStaleness } from './canary-staleness.mjs';
import { mergePackageLists, parsePackageList, publishablePackages } from './publishable-packages.mjs';
import { integrityMatches, pollUntilVerified, retryDelayMs, settleWithinBudget } from './registry-verification.mjs';
import { alreadyReported, eventMarker, planDuplicateCleanup, publishFailureMarkdown } from './release-issue.mjs';

const workspace = [
  { name: '@hypequery/datasets', version: '0.0.0-canary-20261122173219' },
  { name: '@hypequery/protocol', version: '0.29.0' },
  { name: '@hypequery/examples-schema', version: '0.1.0', private: true },
  { name: '@hypequery/agent', version: '0.0.0-canary-20261122173219' },
];

test('publishablePackages drops private packages and sorts by name', () => {
  assert.deepEqual(publishablePackages(workspace).map((pkg) => pkg.name), [
    '@hypequery/agent', '@hypequery/datasets', '@hypequery/protocol',
  ]);
});

test('publishablePackages keeps only snapshot versions for a prerelease tag', () => {
  assert.deepEqual(publishablePackages(workspace, { prerelease: 'canary' }), [
    { name: '@hypequery/agent', version: '0.0.0-canary-20261122173219' },
    { name: '@hypequery/datasets', version: '0.0.0-canary-20261122173219' },
  ]);
});

test('parsePackageList accepts changesets publishedPackages and rejects other shapes', () => {
  assert.deepEqual(parsePackageList('[{"name":"@hypequery/mcp","version":"0.15.3"}]'), [
    { name: '@hypequery/mcp', version: '0.15.3' },
  ]);
  assert.deepEqual(parsePackageList(''), []);
  assert.throws(() => parsePackageList('{"name":"x"}'), /JSON array/);
  assert.throws(() => parsePackageList('[{"name":"x"}]'), /entries must be/);
});

test('mergePackageLists de-duplicates on name@version', () => {
  const a = [{ name: 'b', version: '1.0.0' }, { name: 'a', version: '1.0.0' }];
  const b = [{ name: 'a', version: '1.0.0' }, { name: 'a', version: '1.1.0' }];
  assert.deepEqual(mergePackageLists(a, b).map((pkg) => `${pkg.name}@${pkg.version}`), ['a@1.0.0', 'a@1.1.0', 'b@1.0.0']);
});

test('integrityMatches checks an SRI sha512 value', () => {
  const bytes = Buffer.from('tarball bytes');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.equal(integrityMatches(bytes, integrity), true);
  assert.equal(integrityMatches(Buffer.from('other bytes'), integrity), false);
  assert.equal(integrityMatches(bytes, ''), false);
  assert.equal(integrityMatches(bytes, `md5-abc ${integrity}`), true);
});

test('retryDelayMs backs off from 10s to a 30s cap', () => {
  assert.deepEqual([1, 2, 3, 5, 20].map(retryDelayMs), [10_000, 15_000, 20_000, 30_000, 30_000]);
});

function fakeClock() {
  let time = 0;
  return { now: () => time, sleep: async (ms) => { time += ms; } };
}

test('pollUntilVerified retries until a lagging version appears', async () => {
  const clock = fakeClock();
  let calls = 0;
  const failures = await pollUntilVerified([{ name: 'a', version: '1.0.0' }], async () => {
    calls += 1;
    return calls < 3 ? { ok: false, reason: 'not yet' } : { ok: true };
  }, { ...clock, timeoutMs: 300_000 });
  assert.deepEqual(failures, []);
  assert.equal(calls, 3);
});

test('pollUntilVerified gives up at the deadline with the last reason', async () => {
  const clock = fakeClock();
  let calls = 0;
  const failures = await pollUntilVerified([{ name: 'a', version: '1.0.0' }, { name: 'b', version: '2.0.0' }], async (pkg) => {
    calls += 1;
    if (pkg.name === 'b') return { ok: true };
    throw new Error('E404');
  }, { ...clock, timeoutMs: 300_000 });
  assert.deepEqual(failures, [{ item: { name: 'a', version: '1.0.0' }, reason: 'E404' }]);
  assert.ok(clock.now() <= 300_000, 'never sleeps past the deadline');
  assert.ok(calls > 5, 'kept retrying the missing version');
});

test('pollUntilVerified cuts off a stalled check when the budget runs out', async () => {
  const started = Date.now();
  let seen;
  const failures = await pollUntilVerified([{ name: 'a', version: '1.0.0' }], (_pkg, budget) => {
    seen = budget;
    return new Promise(() => {}); // a request that never answers
  }, { timeoutMs: 100 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1_000, `returned after ${elapsed}ms, not when the check ended`);
  assert.equal(failures.length, 1);
  assert.match(failures[0].reason, /budget ran out/);
  assert.ok(seen.timeoutMs > 0 && seen.timeoutMs <= 100, 'check got the remaining budget');
  assert.equal(seen.signal.aborted, true, 'check was told to stop');
});

test('pollUntilVerified hands later attempts only what is left of the budget', async () => {
  const clock = fakeClock();
  const budgets = [];
  await pollUntilVerified([{ name: 'a', version: '1.0.0' }], async (_pkg, { timeoutMs }) => {
    budgets.push(timeoutMs);
    return { ok: false, reason: 'missing' };
  }, { ...clock, timeoutMs: 60_000 });
  assert.equal(budgets[0], 60_000);
  assert.equal(budgets[1], 50_000);
  assert.ok(budgets.every((budget, index) => index === 0 || budget < budgets[index - 1]));
});

test('settleWithinBudget passes results through until the signal aborts', async () => {
  assert.deepEqual(await settleWithinBudget(Promise.resolve({ ok: true }), new AbortController().signal, 'late'), { ok: true });
  assert.deepEqual(await settleWithinBudget(Promise.reject(new Error('E404')), new AbortController().signal, 'late'), { ok: false, reason: 'E404' });
  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(await settleWithinBudget(new Promise(() => {}), aborted.signal, 'late'), { ok: false, reason: 'late' });
});

test('planDuplicateCleanup keeps the oldest open issue', () => {
  const open = [{ number: 12, url: 'u12' }, { number: 10, url: 'u10' }, { number: 11, url: 'u11' }];
  assert.deepEqual(planDuplicateCleanup(open, 10), {
    keep: { number: 10, url: 'u10' },
    close: [{ number: 11, url: 'u11' }, { number: 12, url: 'u12' }],
    repostOnKept: false,
  });
  const lost = planDuplicateCleanup(open, 12);
  assert.equal(lost.keep.number, 10);
  assert.equal(lost.repostOnKept, true, 'the newer run moves its report to the kept issue');
  assert.deepEqual(planDuplicateCleanup([], 7), { keep: { number: 7 }, close: [], repostOnKept: false });
});

test('canary staleness compares the canary publish time with the latest package commit', () => {
  const commitTime = '2026-11-22T12:00:00Z';
  const fresh = new Date(Date.parse(commitTime) - 2 * DAY_MS).toISOString();
  const stale = new Date(Date.parse(commitTime) - 3.5 * DAY_MS).toISOString();
  assert.equal(evaluateCanaryStaleness({ canaryTime: fresh, commitTime }).stale, false);
  assert.equal(evaluateCanaryStaleness({ canaryTime: stale, commitTime }).stale, true);
  assert.equal(evaluateCanaryStaleness({ canaryTime: '2026-11-23T00:00:00Z', commitTime }).lagDays, 0);
  assert.equal(evaluateCanaryStaleness({ canaryTime: null, commitTime }).stale, true);
});

test('changedReportDirs finds committed API reports only', () => {
  assert.deepEqual(changedReportDirs([
    'packages/protocol/api-report/index.api.md',
    'packages/datasets/api-report/schemas.api.md',
    'packages/datasets/src/index.ts',
    'packages/protocol/api-report/README.md',
  ]), ['datasets', 'protocol']);
});

const breakingChangeset = `---
"@hypequery/protocol": minor
'@hypequery/datasets': patch
---

Widen \`ProtocolDatasetContract.source\` to a union.

Consumer-breaking: \`source\` may now be an object. Migration: narrow with \`typeof source === 'string'\`.
`;

test('parseChangeset reads quoted package names and the summary', () => {
  const parsed = parseChangeset(breakingChangeset);
  assert.deepEqual(parsed.packages, ['@hypequery/protocol', '@hypequery/datasets']);
  assert.match(consumerBreakingValue(parsed.summary), /^`source` may now be an object/);
  assert.equal(consumerBreakingValue('Consumer-breaking: no'), 'no');
  assert.equal(consumerBreakingValue('Consumer-breaking:'), null);
  assert.equal(consumerBreakingValue('No declaration here'), null);
});

test('findUndeclaredApiChanges needs a covering changeset with a declaration', () => {
  const declared = parseChangeset(breakingChangeset);
  const undeclared = parseChangeset('---\n"@hypequery/deployment": patch\n---\n\nFix a bug.\n');
  assert.deepEqual(findUndeclaredApiChanges(['@hypequery/protocol'], [declared]), []);
  assert.deepEqual(findUndeclaredApiChanges(['@hypequery/deployment', '@hypequery/serve'], [declared, undeclared]), [
    { name: '@hypequery/deployment', reason: 'its changeset has no `Consumer-breaking:` line' },
    { name: '@hypequery/serve', reason: 'no changeset in this PR bumps the package' },
  ]);
});

test('publish failure issue text lists missing versions and links the run', () => {
  const marker = eventMarker('publish-failure:1:1:canary-release');
  const markdown = publishFailureMarkdown({
    job: 'canary-release',
    runUrl: 'https://github.com/hypequery/hypequery/actions/runs/1',
    sha: 'abc',
    missing: [{ name: '@hypequery/datasets', version: '0.0.0-canary-1' }],
    resolved: [{ name: '@hypequery/protocol', version: '0.0.0-canary-1' }],
    unknownExpected: false,
    marker,
  });
  assert.match(markdown, /`@hypequery\/datasets@0\.0\.0-canary-1`/);
  assert.match(markdown, /actions\/runs\/1/);
  assert.match(markdown, /Published and resolving: `@hypequery\/protocol@0\.0\.0-canary-1`/);
  assert.equal(alreadyReported({ body: 'x', comments: [{ body: markdown }] }, marker), true);
  assert.equal(alreadyReported({ body: 'x', comments: [] }, marker), false);
});
