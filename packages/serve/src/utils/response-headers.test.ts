import { describe, expect, it } from 'vitest';
import { mergeResponseHeaders, withContentType, withDefaultContentType } from './response-headers.js';

describe('response header helpers', () => {
  it('replaces content-type in any casing', () => {
    expect(withContentType({ 'Content-Type': 'application/json', 'x-a': '1' }, 'application/x-ndjson'))
      .toEqual({ 'x-a': '1', 'content-type': 'application/x-ndjson' });
  });

  it('defaults content-type only when no casing of it is present', () => {
    expect(withDefaultContentType({ 'Content-Type': 'text/csv' }, 'application/json'))
      .toEqual({ 'Content-Type': 'text/csv' });
    expect(withDefaultContentType(undefined, 'application/json')).toEqual({ 'content-type': 'application/json' });
  });

  it('applies headers over others in any casing, combining vary', () => {
    expect(mergeResponseHeaders(
      { Vary: 'Accept', 'Access-Control-Allow-Origin': 'https://old.example.com', 'x-request-id': 'r' },
      { vary: 'Origin, accept', 'access-control-allow-origin': 'https://app.example.com' },
    )).toEqual({
      'x-request-id': 'r',
      vary: 'Accept, Origin',
      'access-control-allow-origin': 'https://app.example.com',
    });
    expect(mergeResponseHeaders(undefined, { vary: 'Origin' })).toEqual({ vary: 'Origin' });
  });
});
