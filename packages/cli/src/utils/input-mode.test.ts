import { afterEach, describe, expect, it } from 'vitest';
import { isCiEnvironment, isUnattended, setUnattended } from './input-mode.js';
import { childProcessStdio, disableJsonOutput, enableJsonOutput } from './machine-output.js';
import { assertCanPrompt } from './prompts.js';

describe('input mode', () => {
  afterEach(() => {
    setUnattended(false, {});
    disableJsonOutput();
  });

  it('reads CI the way CI providers set it', () => {
    expect(isCiEnvironment({ CI: 'true' })).toBe(true);
    expect(isCiEnvironment({ CI: '1' })).toBe(true);
    expect(isCiEnvironment({ CI: 'false' })).toBe(false);
    expect(isCiEnvironment({ CI: '0' })).toBe(false);
    expect(isCiEnvironment({ CI: '' })).toBe(false);
    expect(isCiEnvironment({})).toBe(false);
  });

  it('is attended until the executable says otherwise, then unattended with --no-input or CI', () => {
    expect(isUnattended()).toBe(false);
    setUnattended(false, {});
    expect(isUnattended()).toBe(false);
    setUnattended(false, { CI: 'true' });
    expect(isUnattended()).toBe(true);
    setUnattended(true, {});
    expect(isUnattended()).toBe(true);
  });

  it('refuses to prompt in a terminal when unattended, naming the flag to pass', () => {
    expect(() => assertCanPrompt({ isTTY: true }, '--style queries|datasets')).not.toThrow();
    setUnattended(true, {});
    expect(() => assertCanPrompt({ isTTY: true }, '--style queries|datasets'))
      .toThrow(expect.objectContaining({ code: 'INPUT_REQUIRED', hint: 'Pass --style queries|datasets.' }));
    setUnattended(false, { CI: 'true' });
    expect(() => assertCanPrompt({ isTTY: true }, '--force')).toThrow(/--force/);
  });

  it('gives package installers no stdin when unattended, even without --json', () => {
    expect(childProcessStdio()).toBe('inherit');
    setUnattended(true, {});
    expect(childProcessStdio()).toEqual(['ignore', 'inherit', 'inherit']);
    enableJsonOutput(() => undefined);
    expect(childProcessStdio()).toEqual(['ignore', 2, 2]);
  });
});
