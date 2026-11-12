import { afterEach, describe, expect, it } from 'vitest';
import { isCiEnvironment, isUnattended, setNoInput } from './input-mode.js';
import { assertCanPrompt } from './prompts.js';

describe('input mode', () => {
  afterEach(() => setNoInput(false));

  it('reads CI the way CI providers set it', () => {
    expect(isCiEnvironment({ CI: 'true' })).toBe(true);
    expect(isCiEnvironment({ CI: '1' })).toBe(true);
    expect(isCiEnvironment({ CI: 'false' })).toBe(false);
    expect(isCiEnvironment({ CI: '0' })).toBe(false);
    expect(isCiEnvironment({ CI: '' })).toBe(false);
    expect(isCiEnvironment({})).toBe(false);
  });

  it('is unattended with --no-input or CI', () => {
    expect(isUnattended({})).toBe(false);
    expect(isUnattended({ CI: 'true' })).toBe(true);
    setNoInput(true);
    expect(isUnattended({})).toBe(true);
  });

  it('refuses to prompt in a terminal with --no-input, naming the flag to pass', () => {
    const ci = process.env.CI;
    delete process.env.CI;
    try {
      expect(() => assertCanPrompt({ isTTY: true }, '--style queries|datasets')).not.toThrow();
      setNoInput(true);
      expect(() => assertCanPrompt({ isTTY: true }, '--style queries|datasets'))
        .toThrow(expect.objectContaining({ code: 'INPUT_REQUIRED', hint: 'Pass --style queries|datasets.' }));
      setNoInput(false);
      process.env.CI = 'true';
      expect(() => assertCanPrompt({ isTTY: true }, '--force')).toThrow(/--force/);
    } finally {
      if (ci === undefined) delete process.env.CI; else process.env.CI = ci;
    }
  });
});
