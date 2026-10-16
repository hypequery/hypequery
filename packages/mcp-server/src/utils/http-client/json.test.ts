import { describe, expect, it } from 'vitest';
import { decodeHttpResultJson, HttpResultJsonBudgetError } from './json.js';

describe('HTTP result JSON boundary', () => {
  it.each([
    '{"data":[{"value":"braces [{}], colon: and \\\"quotes\\\""}],"meta":null}',
    '{"data":[{"__proto__":null,"value":-0,"large":9007199254740993,"exponent":1.2e-3}]}',
    ' { "empty": [], "object": {}, "nested": [true, false, null, [1, 2]] } ',
    '["a\\\\b", "a\\u0000b", "😀", "\\uD83D\\uDE00"]',
    'null', 'true', '1e3', '-0',
  ])('preserves native HTTP scalar semantics for %s', text => {
    expect(decodeHttpResultJson(text)).toEqual(JSON.parse(text));
  });
  it.each([
    '{"data":[],"data":[]}', '{"data":[{"a":1,"\\u0061":2}]}',
    '{"data":[{"a\\\"b":1,"a\\u0022b":2}]}',
    '{', '[1,]', '{"a":}', '{"a":1,}', '[[]', '"unterminated', 'NaN', '{"a":"\\x00"}',
  ])('refuses duplicates and malformed syntax: %s', text => {
    expect(() => decodeHttpResultJson(text)).toThrow();
  });
  it('checks exact array/member/depth boundaries', () => {
    expect(decodeHttpResultJson(JSON.stringify(Array(1000).fill(0)))).toHaveLength(1000);
    expect(() => decodeHttpResultJson(JSON.stringify(Array(1001).fill(0)))).toThrow(HttpResultJsonBudgetError);
    const map = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [String(index), index]));
    expect(Object.keys(decodeHttpResultJson(JSON.stringify(map)) as object)).toHaveLength(1000);
    expect(() => decodeHttpResultJson(JSON.stringify({ ...map, extra: 1 }))).toThrow(HttpResultJsonBudgetError);
    expect(() => decodeHttpResultJson('['.repeat(16) + '0' + ']'.repeat(16))).not.toThrow();
    expect(() => decodeHttpResultJson('['.repeat(17) + '0' + ']'.repeat(17))).toThrow(HttpResultJsonBudgetError);
  });
  it('bounds total nodes and UTF-8 bytes, rather than only collection lengths', () => {
    const rows = Array.from({ length: 1000 }, () => Array(10).fill(0));
    expect(() => decodeHttpResultJson(JSON.stringify(rows))).toThrow(HttpResultJsonBudgetError);
    expect(() => decodeHttpResultJson(JSON.stringify('€'.repeat(350000)))).toThrow(HttpResultJsonBudgetError);
  });
});
