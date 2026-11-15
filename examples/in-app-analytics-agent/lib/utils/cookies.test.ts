import { describe, expect, it } from 'vitest';
import { readCookie } from './cookies';

describe('readCookie', () => {
  it('reads and decodes one cookie among several', () => {
    expect(readCookie('theme=dark; demo_user=ada%20l; other=a=b', 'demo_user')).toBe('ada l');
    expect(readCookie('theme=dark; other=a=b', 'other')).toBe('a=b');
  });

  it('has no value for a missing header or cookie', () => {
    expect(readCookie(null, 'demo_user')).toBeUndefined();
    expect(readCookie('theme=dark', 'demo_user')).toBeUndefined();
  });

  it('treats a malformed escape as no cookie, not an error', () => {
    expect(readCookie('demo_user=%E0%A4%A', 'demo_user')).toBeUndefined();
  });
});
