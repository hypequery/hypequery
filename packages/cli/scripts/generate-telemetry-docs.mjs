import { readFile, writeFile } from 'node:fs/promises';
import { renderTelemetryCatalog } from '../dist/utils/telemetry/catalog-docs.js';

const page = new URL('../../../website-next/docs/telemetry.mdx', import.meta.url);
const marker = '{/* telemetry-catalog */}';
const contents = await readFile(page, 'utf8');
const start = contents.indexOf(marker);
if (start < 0) throw new Error('Telemetry docs catalog marker is missing.');
const expected = `${contents.slice(0, start)}${marker}\n\n${renderTelemetryCatalog()}`;
if (process.argv.includes('--check')) {
  if (contents !== expected) throw new Error('Telemetry docs drifted. Run pnpm --filter @hypequery/cli telemetry:docs.');
} else {
  await writeFile(page, expected);
}
