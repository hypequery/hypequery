import { describe, expect, it } from 'vitest';
import { describeConnectionError } from './connection-error.js';

describe('describeConnectionError', () => {
  it('uses the error message when there is one', () => {
    expect(describeConnectionError(new Error('Authentication failed'))).toBe('Authentication failed');
  });

  it('reads an empty AggregateError through its inner errors', () => {
    const error = Object.assign(
      new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:9')], ''),
      { code: 'ECONNREFUSED' },
    );

    expect(describeConnectionError(error)).toBe('connect ECONNREFUSED 127.0.0.1:9');
  });

  it('falls back to the error code', () => {
    const error = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });

    expect(describeConnectionError(error)).toBe('ECONNREFUSED');
  });

  it('stringifies non-errors', () => {
    expect(describeConnectionError('boom')).toBe('boom');
  });
});
