#!/usr/bin/env node
// Fail unless every listed version resolves on npm and its tarball downloads
// and matches dist.integrity. Retries for registry/CDN lag (default 5 min).
//
//   --packages-file <file>  JSON [{ name, version }] (repeatable; missing files are an error)
//   --packages-json <json>  the same, inline (e.g. changesets' publishedPackages)
//   --timeout-seconds <n>   total retry budget (default 300)

import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkPublishedVersion } from './utils/npm-registry.mjs';
import { mergePackageLists, packageSpec, parsePackageList } from './utils/publishable-packages.mjs';
import { DEFAULT_TIMEOUT_MS, pollUntilVerified } from './utils/registry-verification.mjs';

const { values } = parseArgs({
  options: {
    'packages-file': { type: 'string', multiple: true, default: [] },
    'packages-json': { type: 'string', multiple: true, default: [] },
    'timeout-seconds': { type: 'string' },
  },
});

const packages = mergePackageLists(
  ...values['packages-file'].map((file) => parsePackageList(readFileSync(file, 'utf8'), file)),
  ...values['packages-json'].map((json) => parsePackageList(json, '--packages-json')),
);
const timeoutMs = values['timeout-seconds'] ? Number(values['timeout-seconds']) * 1000 : DEFAULT_TIMEOUT_MS;

if (packages.length === 0) {
  console.log('No package versions to verify.');
  process.exit(0);
}

console.log(`Verifying ${packages.length} version(s) on npm (up to ${Math.round(timeoutMs / 1000)}s):`);
for (const pkg of packages) console.log(`  ${packageSpec(pkg)}`);

const failures = await pollUntilVerified(packages, checkPublishedVersion, {
  timeoutMs,
  onAttempt: ({ attempt, pending }) => {
    if (pending.length > 0) {
      console.log(`Attempt ${attempt}: ${pending.length} not yet verified: ${pending.map(({ item, reason }) => `${packageSpec(item)} (${reason})`).join(', ')}`);
    } else {
      console.log(`Attempt ${attempt}: all versions verified.`);
    }
  },
});

const summary = [
  '### npm publish verification',
  '',
  ...packages.map((pkg) => {
    const failure = failures.find(({ item }) => packageSpec(item) === packageSpec(pkg));
    return failure ? `- ❌ \`${packageSpec(pkg)}\`: ${failure.reason}` : `- ✅ \`${packageSpec(pkg)}\``;
  }),
  '',
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);

if (failures.length > 0) {
  for (const { item, reason } of failures) {
    console.error(`::error::${packageSpec(item)} is not available on npm: ${reason}`);
  }
  process.exit(1);
}
