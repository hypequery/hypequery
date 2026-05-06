import { describe, expect, it } from 'vitest';
import { normalizeInitOptions } from './cli.js';

describe('normalizeInitOptions', () => {
  it('maps Commander no-interactive flags onto noInteractive', () => {
    expect(normalizeInitOptions({ interactive: false })).toMatchObject({
      interactive: false,
      noInteractive: true,
    });
  });

  it('preserves explicit noInteractive values', () => {
    expect(normalizeInitOptions({ noInteractive: true, interactive: true })).toMatchObject({
      interactive: true,
      noInteractive: true,
    });
  });
});
