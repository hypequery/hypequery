import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { DatasetClient } from '@hypequery/datasets';
import type { ProtocolBusinessContext } from '@hypequery/protocol';
import { HypequeryMCPExecutor } from '../executor.js';
import { DATASET_LIST_OUTPUT_SCHEMA } from '../tools/tool-manifest.js';
import {
  LIST_DATASETS_CONTEXT_INLINE_BYTES,
  formatBusinessContext,
  listDatasetsBusinessContext,
  resolveMCPBusinessContext,
  type MCPBusinessContext,
} from './business-context.js';

const fixtures = new URL('../../../../specs/security-protocol/fixtures/business-context-v1/', import.meta.url);
const success = JSON.parse(readFileSync(new URL('success.json', fixtures), 'utf8')) as {
  id: string;
  value: ProtocolBusinessContext;
  empty: boolean;
}[];
// Long single values add bytes to the snapshot without exercising anything new.
const LONG_TEXT = new Set(['text-at-utf16-limit', 'padding-does-not-count-toward-length']);

const encoder = new TextEncoder();
const header = { kind: 'hypequery-business-context', version: 1 } as const;

/** A context whose `list_datasets` JSON is `bytes` long: eight two-byte goals and an ASCII summary. */
function sized(bytes: number): ProtocolBusinessContext {
  const goals = Array.from({ length: 8 }, () => 'é'.repeat(2_000));
  const rest = encoder.encode(JSON.stringify({ summary: '', goals })).byteLength;
  return { ...header, summary: 'x'.repeat(bytes - rest), goals };
}

function listed(document: ProtocolBusinessContext): Record<string, unknown> {
  return listDatasetsBusinessContext(resolveMCPBusinessContext(document) as MCPBusinessContext);
}

describe('shared business context MCP snapshot', () => {
  // Python's `hypequery.mcp` advertises the same tool, list_datasets wording and
  // output schema, and lists and formats each document to the same bytes.
  // Regenerate deliberately with `vitest -u` and review the diff.
  it('pins the tool, the listing and the Markdown for the shared documents', async () => {
    const executor = new HypequeryMCPExecutor({
      datasets: { orders: { description: 'Orders', dimensions: {}, measures: {} } },
      analytics: { execute: vi.fn() } as unknown as DatasetClient,
      businessContext: { ...header, summary: 'Present.' },
    });
    const { tools } = await executor.listTools();
    const listSuccess = (DATASET_LIST_OUTPUT_SCHEMA as { oneOf: { properties: Record<string, unknown> }[] })
      .oneOf[0];

    const boundary = sized(LIST_DATASETS_CONTEXT_INLINE_BYTES);
    const summaryLength = (boundary.summary ?? '').length;
    expect(encoder.encode(JSON.stringify(resolveMCPBusinessContext(boundary))).byteLength)
      .toBe(LIST_DATASETS_CONTEXT_INLINE_BYTES);
    const big = {
      ...header,
      summary: 'Big glossary.',
      glossary: Array.from({ length: 10 }, (_, index) => ({ term: `Term ${index}`, meaning: 'x'.repeat(4_000) })),
    };

    const snapshot = {
      listDatasetsDescription: tools[0].description,
      listDatasetsBusinessContextSchema: listSuccess.properties.businessContext,
      getBusinessContextTool: tools.at(-1),
      documents: success
        .filter(fixture => !fixture.empty && !LONG_TEXT.has(fixture.id))
        .map(fixture => ({
          id: fixture.id,
          listed: listed(fixture.value),
          markdown: formatBusinessContext(fixture.value),
        })),
      headerlessMarkdown: formatBusinessContext({ conventions: 'EUR.' }),
      // Built by `sized(bytes)`: eight goals of 2000 'é' and a summary of `summaryLength` 'x'.
      inlineLimit: {
        bytes: LIST_DATASETS_CONTEXT_INLINE_BYTES,
        summaryLength,
        atLimit: Object.keys(listed(boundary)),
        overLimit: listed(sized(LIST_DATASETS_CONTEXT_INLINE_BYTES + 1)),
      },
      // Ten glossary terms `Term <i>`, each meaning 4000 'x', summary 'Big glossary.'.
      truncated: listed(big),
    };
    expect(snapshot.getBusinessContextTool?.name).toBe('get_business_context');
    await expect(`${JSON.stringify(snapshot, null, 2)}\n`)
      .toMatchFileSnapshot(new URL('../../../../specs/mcp/business-context-v1.json', import.meta.url).pathname);
  });
});
