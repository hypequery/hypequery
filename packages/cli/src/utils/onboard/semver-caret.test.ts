import { describe, expect, it } from 'vitest';
import { satisfiesCaret } from './semver-caret.js';

describe('satisfiesCaret', () => {
  it.each([
    ['0.1.0', '^0.1.0', true],
    ['0.1.9', '^0.1.0', true],
    ['0.2.0', '^0.1.0', false],
    ['0.0.9', '^0.1.0', false],
    ['1.0.0', '^0.1.0', false],
    ['0.1.0-canary.1', '^0.1.0', false],
    ['0.1.0+build.5', '^0.1.0', true],
    ['1.4.2', '^1.2.0', true],
    ['2.0.0', '^1.2.0', false],
    ['1.1.9', '^1.2.0', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['not-a-version', '^0.1.0', false],
  ])('%s in %s is %s', (version, range, expected) => {
    expect(satisfiesCaret(version, range)).toBe(expected);
  });

  it('accepts only caret ranges', () => {
    expect(() => satisfiesCaret('0.1.0', '>=0.1.0')).toThrow('Unsupported range');
  });
});
