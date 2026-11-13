/**
 * Writes src/generated/operations.ts from specs/cloud-api/operations-v1.json.
 *
 *   node codegen/generate.ts          regenerate
 *   node codegen/generate.ts --check  exit 1 if the committed file is stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { GENERATED_PATH, SPEC_PATH } from './paths.ts';
import { renderClientModule } from './render.ts';

const source = renderClientModule(JSON.parse(readFileSync(SPEC_PATH, 'utf8')));

if (process.argv.includes('--check')) {
  if (readFileSync(GENERATED_PATH, 'utf8') !== source) {
    console.error('src/generated/operations.ts is stale. Run `pnpm --filter @hypequery/cloud-client generate`.');
    process.exit(1);
  }
  console.log('src/generated/operations.ts is up to date.');
} else {
  writeFileSync(GENERATED_PATH, source);
  console.log(`Wrote ${GENERATED_PATH}`);
}
