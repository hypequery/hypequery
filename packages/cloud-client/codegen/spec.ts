/**
 * Compares this repository's copy of Cloud's operations spec with Cloud's.
 *
 *   node codegen/spec.ts check  <path-or-url>   exit 1 and list the drift if they differ
 *   node codegen/spec.ts update <path-or-url>   take Cloud's copy and regenerate the client
 *
 * Cloud's copy is the source of truth: `specs/cloud-api/operations-v1.json` in
 * the hypequery Cloud repository.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { GENERATED_PATH, SPEC_PATH } from './paths.ts';
import { assertSpec, renderClientModule } from './render.ts';
import { diffSpecs, formatDiff, isEmptyDiff } from './spec-diff.ts';

async function readSource(location: string): Promise<string> {
  if (/^https?:\/\//.test(location)) {
    const response = await fetch(location);
    if (!response.ok) throw new Error(`GET ${location} returned ${response.status}.`);
    return response.text();
  }
  return readFileSync(location, 'utf8');
}

async function main(): Promise<number> {
  const [command, location] = process.argv.slice(2);
  if ((command !== 'check' && command !== 'update') || !location) {
    console.error('Usage: node codegen/spec.ts <check|update> <path-or-url>');
    return 2;
  }
  const text = await readSource(location);
  const next: unknown = JSON.parse(text);
  assertSpec(next);
  const current: unknown = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
  assertSpec(current);
  const diff = diffSpecs(current, next);

  if (command === 'check') {
    if (isEmptyDiff(diff)) {
      console.log('specs/cloud-api/operations-v1.json matches Cloud.');
      return 0;
    }
    console.error(`specs/cloud-api/operations-v1.json differs from ${location}:\n${formatDiff(diff)}`);
    console.error(`\nRun \`pnpm --filter @hypequery/cloud-client spec:update ${location}\` to take Cloud's copy.`);
    return 1;
  }

  writeFileSync(SPEC_PATH, text.endsWith('\n') ? text : `${text}\n`);
  writeFileSync(GENERATED_PATH, renderClientModule(next));
  console.log(isEmptyDiff(diff) ? 'No operation changes; files rewritten.' : formatDiff(diff));
  console.log('Updated the spec and src/generated/operations.ts. Add a changeset for @hypequery/cloud-client.');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
