import { describe, expect, it } from 'vitest';
import { shellQuote } from './shell-quote.js';

describe('shellQuote', () => {
  it('leaves plain words and quotes the rest', () => {
    expect(shellQuote('src/hypequery-client.ts')).toBe('src/hypequery-client.ts');
    expect(shellQuote('https://cloud.example.test/v1')).toBe('https://cloud.example.test/v1');
    expect(shellQuote('src/generated clients/client.ts')).toBe("'src/generated clients/client.ts'");
    expect(shellQuote("it's $HOME")).toBe(`'it'\\''s $HOME'`);
    expect(shellQuote('')).toBe("''");
  });
});
