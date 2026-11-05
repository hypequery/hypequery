import { readFileSync } from 'node:fs';
import { buildClientContractQuerySchemas } from '@hypequery/datasets/schemas';
import { validateProtocolClientContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { clientHttpManifest } from './manifest.js';
import { mcpClientProfile } from './profile.js';

const directory = new URL('../../../../../specs/security-protocol/fixtures/client-contract-v1/', import.meta.url);
const success = JSON.parse(readFileSync(new URL('success.json', directory), 'utf8')) as { id: string; value: unknown }[];

describe('shared bridge manifest fixture', () => {
  // Python's `hypequery.mcp` advertises these same manifests for the same
  // contracts; regenerate deliberately with `vitest -u` and review the diff.
  it('pins tools/list for every success descriptor at default host limits', async () => {
    const manifests = Object.fromEntries(success.map(item => {
      const contract = validateProtocolClientContract(item.value);
      const manifest = clientHttpManifest(buildClientContractQuerySchemas(mcpClientProfile(contract)), contract.contentHash);
      // Query input schemas are pinned by tool-schemas-v1.json, from the profiled contract.
      const tools = manifest.tools.map(tool => tool.name.startsWith('query_') ? { ...tool, inputSchema: 'tool-schemas-v1.json' } : tool);
      return [item.id, { ...manifest, tools }];
    }));
    await expect(`${JSON.stringify(manifests, null, 2)}\n`)
      .toMatchFileSnapshot(new URL('../../../../../specs/mcp/bridge-manifests-v1.json', import.meta.url).pathname);
  });
});
