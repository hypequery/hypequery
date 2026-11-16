import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLOUD_COMMAND_SHAPES } from '../../commands/cloud-operations.js';
import { renderCloudCommandReference } from './reference-docs.js';

describe('the Cloud operation commands reference page', () => {
  it('matches the commands the CLI registers', async () => {
    const page = await readFile(fileURLToPath(new URL('../../../../../website-next/docs/cloud/cli-operations.mdx', import.meta.url)), 'utf8');
    // Stale? Run `pnpm --filter @hypequery/cli cloud-operations:docs`.
    expect(page).toBe(renderCloudCommandReference(CLOUD_COMMAND_SHAPES));
  });

  it('escapes what MDX would read as JSX or an expression', () => {
    const page = renderCloudCommandReference(CLOUD_COMMAND_SHAPES);
    const prose = page.split('\n').filter(line => line.startsWith('|') || !line.startsWith('{/*'))
      .map(line => line.replace(/`[^`]*`/g, ''));
    for (const line of prose) {
      expect(line, line).not.toMatch(/(^|[^\\])[{}]/);
      expect(line, line).not.toMatch(/<[A-Za-z/]/);
    }
  });
});
