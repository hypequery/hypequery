#!/usr/bin/env node
import { findRepoRoot } from '../utils/repo-root.js';
import { formatIssues, validateRegistry } from '../validate.js';

const rootArg = process.argv.find((arg) => arg.startsWith('--root='))?.slice('--root='.length);
const repoRoot = rootArg ?? findRepoRoot(process.cwd());

const { manifests, issues } = validateRegistry(repoRoot);

if (issues.length > 0) {
  console.error(`Examples registry: ${issues.length} problem${issues.length === 1 ? '' : 's'} found\n`);
  console.error(formatIssues(issues));
  console.error('\nSee packages/examples-schema/README.md for the manifest reference.');
  process.exit(1);
}

const count = (kind: string) => manifests.filter((m) => m.manifest.kind === kind).length;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
console.log(`Examples registry OK: ${plural(count('example'), 'example')}, ${plural(count('recipe'), 'recipe')}, ${plural(count('guide'), 'guide')}.`);
