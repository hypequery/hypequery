import { describe, expect, it } from 'vitest';
import { requestedStreamFormat } from './stream-format.js';

describe('requestedStreamFormat', () => {
  it.each([
    ['application/x-ndjson', 'ndjson'],
    ['application/vnd.apache.arrow.stream', 'arrow'],
    ['application/x-ndjson;q=0, application/json', undefined],
    // q-values decide between a page and a stream.
    ['application/json, application/x-ndjson;q=0.5', undefined],
    ['application/json;q=1, application/x-ndjson;q=0.1', undefined],
    ['application/json;q=0.5, application/x-ndjson', 'ndjson'],
    ['application/x-ndjson, application/json', 'ndjson'],
    ['application/x-ndjson;q=0.8, application/*;q=0.9', undefined],
    ['application/x-ndjson;q=0.8, application/json;q=0.5, */*', 'ndjson'],
    ['application/x-ndjson;q=0.5, */*', undefined],
    ['*/*', undefined],
    // The best stream type wins, the first listed on a tie.
    ['application/x-ndjson;q=0.4, application/vnd.apache.arrow.stream;q=0.9', 'arrow'],
    ['application/vnd.apache.arrow.stream, application/x-ndjson', 'arrow'],
    ['application/x-ndjson;q=abc', undefined],
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
