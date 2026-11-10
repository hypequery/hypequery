#!/usr/bin/env node
/**
 * Write or check the published examples registry consumed by the website.
 *
 *   node dist/bin/registry.js            # write website-next/src/data/examples-registry.json
 *   node dist/bin/registry.js --check    # fail if the committed file is stale
 */
import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../utils/repo-root.js';
import { buildRegistry, renderRegistry } from '../registry.js';
import { formatIssues, type ValidationIssue } from '../validate.js';

const repoRoot = findRepoRoot(process.cwd());
const check = process.argv.includes('--check');
const target = path.join(repoRoot, 'website-next', 'src', 'data', 'examples-registry.json');
const publicDir = path.join(repoRoot, 'website-next', 'public');
const appDir = path.join(repoRoot, 'website-next', 'src', 'app');

let rendered: string;
try {
  rendered = renderRegistry(buildRegistry({ repoRoot, publicDir: check ? undefined : publicDir, appDir }));
} catch (error) {
  const issues = (error as Error & { issues?: ValidationIssue[] }).issues;
  console.error((error as Error).message);
  if (issues) console.error(`\n${formatIssues(issues)}`);
  process.exit(1);
}

const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
if (check) {
  if (current !== rendered) {
    console.error(`${path.relative(repoRoot, target)} is out of date; run "pnpm examples:registry" and commit the result.`);
    process.exit(1);
  }
  console.log('Examples registry file is up to date.');
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, rendered);
  console.log(`wrote ${path.relative(repoRoot, target)}`);
}
