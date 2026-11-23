import { describe, expect, it } from 'vitest';
import { MCPToolError } from '../../errors.js';
import { queryValidationError } from './query-validation-error.js';

describe('queryValidationError', () => {
  it('turns a dataset client refusal into a correctable argument error', () => {
    const error = queryValidationError(new Error('Invalid dataset query: Filled queries require exactly one bounded time range.'), 'query_dataset');
    expect(error).toBeInstanceOf(MCPToolError);
    expect(error).toMatchObject({
      code: 'MCP_INVALID_ARGUMENTS',
      message: 'Invalid query_dataset arguments: Filled queries require exactly one bounded time range.',
      retryable: false,
      correctable: true,
    });
    expect(queryValidationError(new Error('Invalid metric query: a; b'), 'query_metric')?.message)
      .toBe('Invalid query_metric arguments: a; b');
  });

  it('leaves every other failure alone', () => {
    expect(queryValidationError(new Error('Code: 60. Table default.orders does not exist'), 'query_dataset')).toBeUndefined();
    expect(queryValidationError(new MCPToolError('MCP_QUERY_TIMEOUT', 'Invalid dataset query: x'), 'query_dataset')).toBeUndefined();
    expect(queryValidationError('Invalid dataset query: x', 'query_dataset')).toBeUndefined();
  });
});
