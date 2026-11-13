import { describe, expect, it } from 'vitest';
import { parseErrorEnvelope } from './error-envelope.js';

describe('parseErrorEnvelope', () => {
  it('returns undefined for anything that is not an envelope', () => {
    for (const body of [null, 'x', [], {}, { error: 'x' }, { error: { code: 1, message: 'm' } }, { error: { code: 'X' } }]) {
      expect(parseErrorEnvelope(body)).toBeUndefined();
    }
  });

  it('defaults missing fields and derives correctable from the category', () => {
    expect(parseErrorEnvelope({ error: { code: 'X', message: 'm', category: 'correctable_input' } })).toEqual({
      code: 'X',
      message: 'm',
      hint: '',
      docsUrl: '',
      category: 'correctable_input',
      retryable: false,
      correctable: true,
      requestId: '',
    });
    expect(parseErrorEnvelope({ error: { code: 'X', message: 'm' } })?.category).toBe('internal');
  });

  it('keeps well-formed issues only', () => {
    const parsed = parseErrorEnvelope({
      error: { code: 'INVALID_INPUT', message: 'm', issues: [{ path: 'a', message: 'b', extra: 1 }, { path: 1 }] },
    });
    expect(parsed?.issues).toEqual([{ path: 'a', message: 'b' }]);
  });
});
