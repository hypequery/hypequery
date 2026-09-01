import { describe, expect, it } from 'vitest';
import {
  MCPExecutionBudgetError,
  MCPToolError,
  classifyMCPToolError,
  formatMCPToolError,
} from './errors.js';

describe('stable MCP tool errors', () => {
  it('preserves budget classifications and retryability', () => {
    expect(classifyMCPToolError(new MCPExecutionBudgetError(
      'MCP_QUERY_TIMEOUT',
      'deadline exceeded',
    ))).toEqual({
      code: 'MCP_QUERY_TIMEOUT',
      category: 'budget',
      message: 'deadline exceeded',
      retryable: true,
      correctable: false,
    });
  });

  it('classifies validation and lookup failures', () => {
    expect(classifyMCPToolError(new Error('Invalid query_dataset arguments: limit')))
      .toMatchObject({
        code: 'MCP_INVALID_ARGUMENTS',
        category: 'correctable_input',
        retryable: false,
        correctable: true,
      });
    expect(classifyMCPToolError(new Error('Dataset not found: secret')))
      .toMatchObject({ code: 'MCP_NOT_FOUND', retryable: false });
  });

  it('provides stable host-facing authorization and contract categories', () => {
    expect(classifyMCPToolError(new MCPToolError('MCP_UNAUTHORIZED', 'Forbidden')))
      .toMatchObject({ category: 'unauthorized', retryable: false });
    expect(classifyMCPToolError(new MCPToolError('MCP_STALE_CONTRACT', 'Relist tools')))
      .toMatchObject({ category: 'stale_contract', retryable: true });
  });

  it('redacts unclassified execution details', () => {
    const classified = classifyMCPToolError(new Error(
      'DB::Exception: SELECT password FROM private_table',
    ));

    expect(classified).toEqual({
      code: 'MCP_EXECUTION_FAILED',
      category: 'internal',
      message: 'Query execution failed',
      retryable: true,
      correctable: false,
    });
    expect(formatMCPToolError(new Error('SELECT password')))
      .toBe('Error [MCP_EXECUTION_FAILED]: Query execution failed');
  });
});
