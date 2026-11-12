import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliError } from './cli-error.js';
import { assertCanPrompt, canPrompt, isCiEnvironment, isJsonOutput, resolveOutputMode, setOutputMode } from './output-mode.js';

const tty = { isTTY: true };
const pipe = { isTTY: false };

describe('resolveOutputMode', () => {
  it('is interactive only in a terminal without --json, --no-input, --yes or CI', () => {
    expect(resolveOutputMode({ stdin: tty, stdout: tty, env: {} })).toEqual({ json: false, interactive: true, unattended: false });
    expect(resolveOutputMode({ stdin: pipe, stdout: tty, env: {} }).interactive).toBe(false);
    expect(resolveOutputMode({ stdin: tty, stdout: pipe, env: {} }).interactive).toBe(false);
    expect(resolveOutputMode({ stdin: tty, stdout: tty, env: {}, json: true })).toEqual({ json: true, interactive: false, unattended: false });
    expect(resolveOutputMode({ stdin: tty, stdout: tty, env: {}, noInput: true })).toEqual({ json: false, interactive: false, unattended: true });
    expect(resolveOutputMode({ stdin: tty, stdout: tty, env: {}, yes: true })).toEqual({ json: false, interactive: false, unattended: false });
    expect(resolveOutputMode({ stdin: tty, stdout: tty, env: { CI: 'true' } })).toEqual({ json: false, interactive: false, unattended: true });
  });

  it('reads CI the way CI providers set it', () => {
    expect(isCiEnvironment({ CI: 'true' })).toBe(true);
    expect(isCiEnvironment({ CI: '1' })).toBe(true);
    expect(isCiEnvironment({ CI: 'false' })).toBe(false);
    expect(isCiEnvironment({ CI: '0' })).toBe(false);
    expect(isCiEnvironment({ CI: '' })).toBe(false);
    expect(isCiEnvironment({})).toBe(false);
  });
});

describe('output mode state', () => {
  let restore: (() => void) | undefined;
  afterEach(() => { restore?.(); restore = undefined; });

  it('lets standalone command calls prompt as before', () => {
    expect(canPrompt()).toBe(true);
    expect(isJsonOutput()).toBe(false);
    expect(() => assertCanPrompt('"Pick one"', '--pick')).not.toThrow();
  });

  it('fails fast with INPUT_REQUIRED naming the flag when it cannot prompt', () => {
    restore = setOutputMode({ json: true, interactive: false, unattended: false });
    expect(isJsonOutput()).toBe(true);
    let thrown: unknown;
    try { assertCanPrompt('"Choose your dev API style"', '--style queries|datasets'); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(CliError);
    expect(thrown).toMatchObject({ code: 'INPUT_REQUIRED', exitCode: 1 });
    expect((thrown as Error).message).toContain('--style queries|datasets');
    expect((thrown as CliError).hint).toContain('--style queries|datasets');
  });

  it('never reaches the prompt library without a terminal', async () => {
    vi.resetModules();
    const promptsMock = vi.fn();
    vi.doMock('prompts', () => ({ default: promptsMock }));
    const { promptInitStyle, confirmOverwrite } = await import('../prompts.js');
    const outputMode = await import('./output-mode.js');
    const undo = outputMode.setOutputMode({ json: false, interactive: false, unattended: true });
    try {
      await expect(promptInitStyle()).rejects.toMatchObject({ code: 'INPUT_REQUIRED', message: expect.stringContaining('--style') });
      await expect(confirmOverwrite(['analytics/client.ts'])).rejects.toMatchObject({ code: 'INPUT_REQUIRED', message: expect.stringContaining('--force') });
      expect(promptsMock).not.toHaveBeenCalled();
    } finally {
      undo();
      vi.doUnmock('prompts');
      vi.resetModules();
    }
  });
});
