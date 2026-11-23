#!/usr/bin/env node
// Daily check: the `canary` dist-tag of a published package must not trail the
// newest main commit that touched a published package by more than N days.
// When it does, report on the `release-failure` issue and exit 1.
//
//   --package <name>         dist-tag to inspect (default @hypequery/datasets)
//   --threshold-days <n>     allowed lag (default 3)
//   --ref <git ref>          commit history to inspect (default HEAD)
//   --dry-run                print the verdict, never touch GitHub issues
//
// Needs full git history for `--ref` (checkout with fetch-depth: 0).

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { evaluateCanaryStaleness, DEFAULT_THRESHOLD_DAYS } from './utils/canary-staleness.mjs';
import { upsertReleaseFailureIssue } from './utils/github-issue.mjs';
import { npmView } from './utils/npm-registry.mjs';
import { isPublishable } from './utils/publishable-packages.mjs';
import { canaryStaleMarkdown, eventMarker } from './utils/release-issue.mjs';
import { readWorkspacePackages } from './utils/workspace-packages.mjs';

const { values } = parseArgs({
  options: {
    package: { type: 'string', default: '@hypequery/datasets' },
    'threshold-days': { type: 'string', default: String(DEFAULT_THRESHOLD_DAYS) },
    ref: { type: 'string', default: 'HEAD' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const packageName = values.package;
const thresholdDays = Number(values['threshold-days']);
const publishedDirs = readWorkspacePackages().filter(isPublishable).map((pkg) => pkg.dir).sort();

const [sha, time] = execFileSync('git', ['log', '-1', '--format=%H%x09%cI', values.ref, '--', ...publishedDirs], {
  encoding: 'utf8',
}).trim().split('\t');
if (!sha) throw new Error(`No commit on ${values.ref} touches ${publishedDirs.join(', ')}; is the checkout shallow?`);

const canaryVersion = await npmView(packageName, ['dist-tags.canary']);
const times = await npmView(packageName, ['time']);
const canaryTime = canaryVersion && times ? times[canaryVersion] ?? null : null;

const verdict = evaluateCanaryStaleness({ canaryTime, commitTime: time, thresholdDays });
console.log(`${packageName}@canary = ${canaryVersion ?? 'missing'} published ${canaryTime ?? 'unknown'}`);
console.log(`Latest commit touching ${publishedDirs.length} published packages: ${sha} at ${time}`);
console.log(`Verdict: ${verdict.stale ? 'STALE' : 'fresh'} (${verdict.reason}, threshold ${thresholdDays} days)`);

if (!verdict.stale) process.exit(0);

const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
const runUrl = GITHUB_RUN_ID ? `${GITHUB_SERVER_URL ?? 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : null;
// One report per (canary version, commit): a daily rerun with nothing new stays quiet.
const marker = eventMarker(`canary-stale:${packageName}:${canaryVersion ?? 'missing'}:${sha}`);
const markdown = canaryStaleMarkdown({
  packageName,
  canaryVersion,
  canaryTime,
  commit: { sha, time },
  lagDays: verdict.lagDays,
  thresholdDays,
  runUrl,
  marker,
});

if (values['dry-run']) {
  console.log(markdown);
} else {
  const { action, url } = await upsertReleaseFailureIssue({ markdown, marker });
  console.log(`Release-failure issue ${action}: ${url}`);
}
console.error(`::error::${packageName} canary is stale: ${verdict.reason}`);
process.exit(1);
