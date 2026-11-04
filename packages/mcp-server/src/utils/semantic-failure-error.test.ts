import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { MCPToolError, classifyMCPToolError } from '../errors.js';
import { createMCPProtocolServer } from '../protocol-server.js';
import { buildMCPToolManifest } from '../tools/tool-manifest.js';
import { buildMCPQuerySchemas } from '../tools/utils/canonical-query-schemas.js';
import { createMCPErrorResponse } from '../tools/utils/tool-response.js';
import { mcpToolErrorFromSemanticFailure } from './semantic-failure-error.js';

const failure = (category: string, code: string, extra: Record<string, unknown> = {}) => ({
  category,
  code,
  message: 'The failure, safe to show.',
  retryable: false,
  relist: false,
  ...extra,
}) as Parameters<typeof mcpToolErrorFromSemanticFailure>[0];

describe('semantic data-plane failures as MCP tool errors', () => {
  it('maps each category to a portable code and keeps the protocol code as reason', () => {
    const cases = [
      ['input-invalid', 'MCP_INVALID_ARGUMENTS', 'correctable_input', true],
      ['not-found', 'MCP_NOT_FOUND', 'correctable_input', true],
      ['tenant-required', 'MCP_UNAUTHORIZED', 'unauthorized', false],
      ['forbidden', 'MCP_UNAUTHORIZED', 'unauthorized', false],
      ['stale-activation', 'MCP_STALE_CONTRACT', 'stale_contract', false],
      ['cancelled', 'MCP_REQUEST_CANCELLED', 'budget', false],
      ['budget-exceeded', 'MCP_RESULT_TOO_LARGE', 'budget', false],
      ['executor-unavailable', 'MCP_EXECUTION_FAILED', 'internal', false],
    ] as const;
    for (const [category, code, mcpCategory, correctable] of cases) {
      const details = classifyMCPToolError(
        mcpToolErrorFromSemanticFailure(failure(category, `HQ_SEMANTIC_${category}`)),
      );
      expect(details).toMatchObject({ code, category: mcpCategory, correctable, reason: `HQ_SEMANTIC_${category}` });
    }
  });

  it('carries the failure retryability, relist and a retry delay', () => {
    expect(classifyMCPToolError(mcpToolErrorFromSemanticFailure(
      failure('executor-unavailable', 'HQ_SEMANTIC_EXECUTION_FAILED', { retryable: true, relist: true }),
      { retryAfterSeconds: 2 },
    ))).toEqual({
      code: 'MCP_EXECUTION_FAILED',
      category: 'internal',
      message: 'The failure, safe to show.',
      retryable: true,
      correctable: false,
      relist: true,
      reason: 'HQ_SEMANTIC_EXECUTION_FAILED',
      retryAfterSeconds: 2,
    });
  });

  it('refuses a negative or non-finite retry delay', () => {
    expect(() => new MCPToolError('MCP_RATE_LIMITED', 'x', { retryAfterSeconds: -1 })).toThrow(RangeError);
    expect(() => new MCPToolError('MCP_RATE_LIMITED', 'x', { retryAfterSeconds: Number.NaN })).toThrow(RangeError);
  });

  it('passes an SDK client\'s output-schema check with every hosted detail set', async () => {
    const schemas = buildMCPQuerySchemas({});
    const manifest = buildMCPToolManifest(schemas);
    const server = createMCPProtocolServer({
      executor: {
        listTools: async () => manifest,
        callTool: async () => createMCPErrorResponse(new MCPToolError('MCP_RATE_LIMITED', 'Too many requests.', {
          retryAfterSeconds: 7,
          relist: false,
          reason: 'HOST_RATE_LIMITED',
        })),
        listPrompts: async () => ({ prompts: [] }),
        getPrompt: async () => ({ messages: [] }),
        getManifestHash: () => schemas.manifestHash,
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'agent', version: '0.0.0' });
    await client.connect(clientTransport);
    await client.listTools();

    const result = await client.callTool({ name: 'query_dataset', arguments: {} });
    expect(result.structuredContent).toEqual({
      error: {
        code: 'MCP_RATE_LIMITED',
        category: 'budget',
        message: 'Too many requests.',
        retryable: true,
        correctable: false,
        retryAfterSeconds: 7,
        relist: false,
        reason: 'HOST_RATE_LIMITED',
      },
    });
    await client.close();
    await server.close();
  });
});
