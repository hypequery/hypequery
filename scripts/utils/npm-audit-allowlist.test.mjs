import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advisoryId, directAdvisories, evaluateAudit, isIsoDate } from './npm-audit-allowlist.mjs';

const PICOMATCH = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const OTHER = 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc';

// Shape taken from a real `npm audit --json` run in website-next.
const report = (extra = {}) => ({
  vulnerabilities: {
    picomatch: { severity: 'high', via: [{ name: 'picomatch', severity: 'high', title: 'ReDoS', url: PICOMATCH }] },
    fdir: { severity: 'high', via: ['picomatch'] },
    tinyglobby: { severity: 'high', via: ['fdir', 'picomatch'] },
    'fumadocs-core': { severity: 'high', via: ['tinyglobby'] },
    ...extra,
  },
});

const allowlist = [{ id: 'GHSA-fc5q-39xc-vjpf', package: 'picomatch', reason: 'build-time only', reviewBy: '2026-12-02' }];

test('advisoryId reads the GHSA id from a URL', () => {
  assert.equal(advisoryId(PICOMATCH), 'GHSA-FC5Q-39XC-VJPF');
  assert.equal(advisoryId('https://example.com/nothing'), null);
});

test('transitive entries add no advisories of their own', () => {
  assert.deepEqual(directAdvisories(report()).map((a) => a.id), ['GHSA-FC5Q-39XC-VJPF']);
});

test('an allowlisted advisory does not block before its review date', () => {
  const result = evaluateAudit(report(), allowlist, '2026-11-18');
  assert.equal(result.blocking.length, 0);
  assert.equal(result.expired.length, 0);
  assert.equal(result.allowed.length, 1);
});

test('the review date itself is still allowed; the day after is not', () => {
  assert.equal(evaluateAudit(report(), allowlist, '2026-12-02').expired.length, 0);
  assert.equal(evaluateAudit(report(), allowlist, '2026-12-03').expired.length, 1);
});

test('a different high advisory blocks even with the allowlist in place', () => {
  const result = evaluateAudit(
    report({ lodash: { severity: 'critical', via: [{ name: 'lodash', severity: 'critical', title: 'x', url: OTHER }] } }),
    allowlist,
    '2026-11-18',
  );
  assert.deepEqual(result.blocking.map((a) => a.id), ['GHSA-AAAA-BBBB-CCCC']);
});

test('the same advisory id on another package is not excused', () => {
  const result = evaluateAudit(
    { vulnerabilities: { micromatch: { severity: 'high', via: [{ name: 'micromatch', severity: 'high', url: PICOMATCH }] } } },
    allowlist,
    '2026-11-18',
  );
  assert.equal(result.blocking.length, 1);
});

test('moderate and low advisories never block', () => {
  const result = evaluateAudit(
    { vulnerabilities: { foo: { severity: 'moderate', via: [{ name: 'foo', severity: 'moderate', url: OTHER }] } } },
    [],
    '2026-11-18',
  );
  assert.deepEqual(result, { blocking: [], allowed: [], expired: [] });
});

test('with no allowlist, the picomatch advisory blocks', () => {
  assert.equal(evaluateAudit(report(), [], '2026-11-18').blocking.length, 1);
});

test('the same advisory on an allowed and an unallowed package blocks the unallowed one, in either order', () => {
  const picomatch = { severity: 'high', via: [{ name: 'picomatch', severity: 'high', url: PICOMATCH }] };
  const micromatch = { severity: 'high', via: [{ name: 'micromatch', severity: 'high', url: PICOMATCH }] };
  for (const vulnerabilities of [{ picomatch, micromatch }, { micromatch, picomatch }]) {
    const result = evaluateAudit({ vulnerabilities }, allowlist, '2026-11-18');
    assert.deepEqual(result.blocking.map((a) => a.package), ['micromatch']);
    assert.deepEqual(result.allowed.map((a) => a.package), ['picomatch']);
  }
});

test('a missing or invalid reviewBy never excuses an advisory', () => {
  for (const reviewBy of [undefined, '', 'TBD', '2026-13-01', '2026-02-30', '2026-1-5', 20261202]) {
    const entry = { ...allowlist[0], reviewBy };
    const result = evaluateAudit(report(), [entry], '2026-11-18');
    assert.equal(result.allowed.length, 0, `reviewBy ${String(reviewBy)}`);
    assert.equal(result.expired.length, 1, `reviewBy ${String(reviewBy)}`);
  }
});

test('an allowlist entry without an id is ignored instead of crashing', () => {
  const result = evaluateAudit(report(), [{ package: 'picomatch', reviewBy: '2026-12-02' }], '2026-11-18');
  assert.equal(result.blocking.length, 1);
});

test('isIsoDate accepts only real calendar dates', () => {
  assert.equal(isIsoDate('2026-12-02'), true);
  assert.equal(isIsoDate('2024-02-29'), true);
  assert.equal(isIsoDate('2026-02-29'), false);
  assert.equal(isIsoDate('TBD'), false);
});
