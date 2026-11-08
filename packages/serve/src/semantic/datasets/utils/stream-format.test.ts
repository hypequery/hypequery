import { describe, expect, it } from 'vitest';
import { requestedStreamFormat } from './stream-format.js';

describe('requestedStreamFormat', () => {
  it.each([
    ['application/x-ndjson', 'ndjson'],
    ['application/vnd.apache.arrow.stream', 'arrow'],
    ['application/json, application/x-ndjson;q=0.5', 'ndjson'],
    ['application/x-ndjson;q=0, application/json', undefined],
    [undefined, undefined],
  ])('%s → %s', (accept, expected) => {
    expect(requestedStreamFormat(accept)).toBe(expected);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'does not match the inherited property %s',
    (accept) => {
      expect(requestedStreamFormat(accept)).toBeUndefined();
    },
  );
});
