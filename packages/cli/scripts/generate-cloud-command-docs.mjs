import { readFile, writeFile } from 'node:fs/promises';
import { CLOUD_COMMAND_SHAPES } from '../dist/commands/cloud-operations.js';
import { renderCloudCommandReference } from '../dist/utils/cloud-operations/reference-docs.js';

const page = new URL('../../../website-next/docs/cloud/cli-operations.mdx', import.meta.url);
const expected = renderCloudCommandReference(CLOUD_COMMAND_SHAPES);
if (process.argv.includes('--check')) {
  const contents = await readFile(page, 'utf8').catch(() => '');
  if (contents !== expected) throw new Error('Cloud operation command docs drifted. Run pnpm --filter @hypequery/cli cloud-operations:docs.');
} else {
  await writeFile(page, expected);
}
