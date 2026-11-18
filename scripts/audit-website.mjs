#!/usr/bin/env node
// Runs `npm audit --omit=dev` for website-next and fails on any high or
// critical advisory that is not in website-next/audit-allowlist.json, or whose
// allowlist entry is past its review date. Policy: CONTRIBUTING.md
// ("Dependency advisories"). Usage: node scripts/audit-website.mjs

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAudit } from './utils/npm-audit-allowlist.mjs';

const websiteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'website-next');
const allowlist = JSON.parse(readFileSync(resolve(websiteDir, 'audit-allowlist.json'), 'utf8')).advisories;

// npm exits non-zero when it finds vulnerabilities, so read stdout regardless.
const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  cwd: websiteDir,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error('npm audit did not return JSON.');
  console.error(audit.stderr || audit.stdout);
  process.exit(2);
}
if (report.error || !report.vulnerabilities) {
  console.error('npm audit failed:', JSON.stringify(report.error ?? report, null, 2));
  process.exit(2);
}

const today = new Date().toISOString().slice(0, 10);
const { blocking, allowed, expired } = evaluateAudit(report, allowlist, today);

for (const advisory of allowed) {
  console.log(`allowed until ${advisory.reviewBy}: ${advisory.id} (${advisory.package}, ${advisory.severity}): ${advisory.reason}`);
}
for (const advisory of expired) {
  console.error(`review date passed (${advisory.reviewBy}): ${advisory.id} (${advisory.package}). Patch it or re-triage and set a new date.`);
}
for (const advisory of blocking) {
  console.error(`${advisory.severity}: ${advisory.id} in ${advisory.package}: ${advisory.title ?? ''} ${advisory.url ?? ''}`);
}

if (blocking.length > 0 || expired.length > 0) {
  console.error(`\n${blocking.length + expired.length} high or critical advisory(ies) need attention.`);
  process.exit(1);
}
console.log('No unexcused high or critical advisories in website-next production dependencies.');
