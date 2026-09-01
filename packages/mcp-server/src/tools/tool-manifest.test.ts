import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { buildMCPQuerySchemas } from './utils/canonical-query-schemas.js';
import { buildMCPToolManifest } from './tool-manifest.js';

describe('MCP tool manifest', () => {
  it('declares valid output schemas, titles, and read-only annotations', () => {
    const manifest = buildMCPToolManifest(buildMCPQuerySchemas({}));

    expect(() => ListToolsResultSchema.parse(manifest)).not.toThrow();
    expect(manifest.tools).toHaveLength(4);
    for (const tool of manifest.tools) {
      expect(tool.title).toEqual(expect.any(String));
      expect(tool.outputSchema).toMatchObject({ type: 'object' });
      expect(tool.annotations).toMatchObject({
        title: tool.title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });
});
