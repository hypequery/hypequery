import { readFile, writeFile } from 'node:fs/promises';
import { COMMON_PROPERTIES, EVENT_CATALOG } from '../../packages/cli/src/utils/telemetry/catalog.js';
import { COMMAND_FLAGS, GLOBAL_FLAGS } from '../../packages/cli/src/utils/telemetry/domains.js';
import { VALUE_FORMATS } from '../../packages/cli/src/utils/telemetry/value-formats.js';

// Commit the contract so Vercel can build the website independently of the monorepo.
const destination = new URL('../src/lib/telemetry/schema.json', import.meta.url);
const schema = JSON.stringify({ COMMON_PROPERTIES, EVENT_CATALOG, COMMAND_FLAGS, GLOBAL_FLAGS, VALUE_FORMATS },
  (_key, value) => value instanceof RegExp ? { source: value.source, flags: value.flags } : value, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(destination, 'utf8') !== schema) throw new Error('Telemetry schema is stale: run npm run telemetry:schema');
} else {
  await writeFile(destination, schema);
}
