#!/usr/bin/env node
// PR check: a change to a committed public API report
// (packages/<pkg>/api-report/*.api.md) needs a changeset, added in the same PR,
// that bumps the package and declares `Consumer-breaking:`. See CLAUDE.md
// ("Public API reports").
//
//   --base <ref>   the PR base (e.g. origin/main); needs full history

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { changedReportDirs, findUndeclaredApiChanges, parseChangeset } from './utils/api-changesets.mjs';

const { values } = parseArgs({ options: { base: { type: 'string', default: 'origin/main' } } });

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const range = `${values.base}...HEAD`;

const dirs = changedReportDirs(git('diff', '--name-only', range));
if (dirs.length === 0) {
  console.log('No public API report changed.');
  process.exit(0);
}

const names = dirs.map((dir) => JSON.parse(readFileSync(`packages/${dir}/package.json`, 'utf8')).name);
const changesets = git('diff', '--name-only', '--diff-filter=AM', range, '--', '.changeset/*.md')
  .filter((file) => !file.endsWith('README.md'))
  .map((file) => parseChangeset(readFileSync(file, 'utf8')));

console.log(`Public API reports changed for: ${names.join(', ')}`);
const problems = findUndeclaredApiChanges(names, changesets);
if (problems.length === 0) {
  console.log('Each has a changeset declaring Consumer-breaking.');
  process.exit(0);
}
for (const { name, reason } of problems) {
  console.error(`::error::${name}'s public API changed but ${reason}.`);
}
console.error([
  '',
  'Add a changeset (pnpm changeset) for each package above whose summary has a line:',
  '  Consumer-breaking: no                      (additive only: new exports or optional inputs)',
  '  Consumer-breaking: <what breaks>. Migration: <what consumers change>',
].join('\n'));
process.exit(1);
