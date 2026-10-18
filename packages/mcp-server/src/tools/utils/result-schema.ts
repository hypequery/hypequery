import type { Tool } from '@modelcontextprotocol/sdk/types.js';

type ObjectSchema = Tool['outputSchema'] & Record<string, unknown>;

const errorEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: {
          type: 'string',
          enum: [
            'MCP_INVALID_ARGUMENTS',
            'MCP_NOT_FOUND',
            'MCP_UNKNOWN_TOOL',
            'MCP_UNAUTHORIZED',
            'MCP_STALE_CONTRACT',
            'MCP_REQUEST_CANCELLED',
            'MCP_QUERY_TIMEOUT',
            'MCP_RESULT_TOO_LARGE',
            'MCP_EXECUTION_FAILED',
          ],
        },
        message: { type: 'string' },
        category: {
          type: 'string',
          enum: [
            'correctable_input',
            'unauthorized',
            'stale_contract',
            'budget',
            'internal',
          ],
        },
        retryable: { type: 'boolean' },
        correctable: { type: 'boolean' },
      },
      required: ['code', 'category', 'message', 'retryable', 'correctable'],
    },
  },
  required: ['error'],
};

export function resultSchema(successSchema: Record<string, unknown>): ObjectSchema {
  return {
    type: 'object',
    oneOf: [successSchema, errorEnvelopeSchema],
  } as ObjectSchema;
}

