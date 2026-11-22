#!/usr/bin/env node
// Called from a failed publish job on main: works out which of the versions the
// job meant to publish are missing from npm and reports them on the open
// `release-failure` issue (creating it if needed).
//
//   --job <name>             job name for the report
//   --expected-file <file>   JSON [{ name, version }] the job recorded before
//                            publishing; may be absent if it failed earlier
//   --packages-json <json>   extra versions the job reported (repeatable)
//
// Env: GH_TOKEN, GH_REPO, and the default GITHUB_* variables for the run link.

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { upsertReleaseFailureIssue } from './utils/github-issue.mjs';
import { versionResolves } from './utils/npm-registry.mjs';
import { mergePackageLists, parsePackageList } from './utils/publishable-packages.mjs';
import { eventMarker, publishFailureMarkdown } from './utils/release-issue.mjs';

const { values } = parseArgs({
  options: {
    job: { type: 'string' },
    'expected-file': { type: 'string' },
    'packages-json': { type: 'string', multiple: true, default: [] },
  },
});

const job = values.job ?? process.env.GITHUB_JOB ?? 'publish';
const expectedFile = values['expected-file'];
const recorded = expectedFile && existsSync(expectedFile);
const expected = mergePackageLists(
  recorded ? parsePackageList(readFileSync(expectedFile, 'utf8'), expectedFile) : [],
  ...values['packages-json'].map((json) => parsePackageList(json, '--packages-json')),
);

const missing = [];
const resolved = [];
const checks = await Promise.all(expected.map(async (pkg) => {
  try {
    return { pkg, ok: await versionResolves(pkg) };
  } catch (error) {
    return { pkg: { ...pkg, reason: error.message }, ok: false };
  }
}));
for (const { pkg, ok } of checks) (ok ? resolved : missing).push(pkg);

const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_SHA } = process.env;
const runUrl = `${GITHUB_SERVER_URL ?? 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
const marker = eventMarker(`publish-failure:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT ?? 1}:${job}`);
const markdown = publishFailureMarkdown({
  job,
  runUrl,
  sha: GITHUB_SHA,
  missing,
  resolved,
  unknownExpected: expected.length === 0 && !recorded,
  marker,
});

console.log(markdown);
const { action, url } = await upsertReleaseFailureIssue({ markdown, marker });
console.log(`Release-failure issue ${action}: ${url}`);
