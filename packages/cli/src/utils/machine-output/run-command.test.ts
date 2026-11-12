import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExit } from '../command-exit.js';
import { logger } from '../logger.js';
import { CliError } from './cli-error.js';
import { mergeCommandResult } from './command-result.js';
import { canPrompt, isJsonOutput } from './output-mode.js';
import { runCommand } from './run-command.js';

function program(action: () => Promise<unknown>, behaviour?: Parameters<typeof runCommand>[1]) {
  const root = new Command().exitOverride();
  root.command('demo')
    .option('--json')
    .option('--no-input')
    .option('-y, --yes')
    .action(runCommand(async () => action(), behaviour));
  return root;
}

describe('runCommand', () => {
  let stdout: string[];
  let stderr: string[];
  beforeEach(() => {
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => { stdout.push(String(chunk)); return true; }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string) => { stderr.push(String(chunk)); return true; }) as typeof process.stderr.write);
  });
  afterEach(() => vi.restoreAllMocks());

  async function run(action: () => Promise<unknown>, args: string[], behaviour?: Parameters<typeof runCommand>[1]) {
    try {
      await program(action, behaviour).parseAsync(['demo', ...args], { from: 'user' });
      return { code: 0 };
    } catch (error) {
      if (error instanceof CommandExit) return { code: error.exitCode, error };
      throw error;
    }
  }

  it('prints exactly the result document on stdout with --json and sends logs to stderr', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args.join(' ')); });
    const result = await run(async () => {
      logger.success('Did the thing');
      console.log('a stray log');
      expect(isJsonOutput()).toBe(true);
      expect(canPrompt()).toBe(false);
      return { ok: true, files: ['a.ts'] };
    }, ['--json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(stdout.join(''))).toEqual({ ok: true, files: ['a.ts'] });
    expect(logged.join('\n')).toContain('Did the thing');
    expect(logged.join('\n')).toContain('a stray log');
    expect(logged.join('\n')).not.toMatch(/\u001b\[/);
  });

  it('prefers the document a command reported over its return value', async () => {
    await run(async () => {
      mergeCommandResult({ bundle: { identity: 'b' } });
      mergeCommandResult({ release: { identity: 'r' } });
      return 'internal return value';
    }, ['--json']);
    expect(JSON.parse(stdout.join(''))).toEqual({ bundle: { identity: 'b' }, release: { identity: 'r' } });
  });

  it('prints the error envelope on stdout and exits with the category\'s code', async () => {
    const result = await run(async () => {
      throw new CliError('UNAUTHENTICATED', 'Missing deployment credential.');
    }, ['--json']);
    expect(result.code).toBe(2);
    const document = JSON.parse(stdout.join(''));
    expect(document).toEqual({
      error: expect.objectContaining({
        code: 'UNAUTHENTICATED',
        message: 'Missing deployment credential.',
        category: 'unauthenticated',
        retryable: false,
        correctable: false,
        exitCode: 2,
        docsUrl: expect.stringContaining('#exit-codes-and-errors'),
        hint: expect.any(String),
      }),
    });
  });

  it('classifies plain errors and keeps human output on stderr without --json', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await run(async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); }, []);
    expect(result.code).toBe(4);
    expect(stdout.join('')).toBe('');
    expect(error).toHaveBeenCalledWith('connect ECONNREFUSED');
  });

  it('does not repeat a failure the command already explained', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await run(async () => { throw new CliError('NOT_FOUND', 'No entrypoint', { reported: true }); }, []);
    expect(result.code).toBe(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('disables prompts with --no-input or --yes even in a terminal', async () => {
    const stdin = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const out = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const ci = process.env.CI;
    delete process.env.CI;
    try {
      let seen: boolean[] = [];
      await run(async () => { seen.push(canPrompt()); }, []);
      await run(async () => { seen.push(canPrompt()); }, ['--no-input']);
      await run(async () => { seen.push(canPrompt()); }, ['--yes']);
      expect(seen).toEqual([true, false, false]);
      seen = [];
      process.env.CI = 'true';
      await run(async () => { seen.push(canPrompt()); }, []);
      expect(seen).toEqual([false]);
    } finally {
      if (ci === undefined) delete process.env.CI; else process.env.CI = ci;
      if (stdin) Object.defineProperty(process.stdin, 'isTTY', stdin); else delete (process.stdin as { isTTY?: boolean }).isTTY;
      if (out) Object.defineProperty(process.stdout, 'isTTY', out); else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });

  it('leaves stdout alone for a command that owns it', async () => {
    await run(async () => {
      process.stdout.write('{"jsonrpc":"2.0"}\n');
    }, ['--json'], { ownsStdout: true });
    expect(stdout.join('')).toBe('{"jsonrpc":"2.0"}\n');
  });

  it('turns a legacy non-zero exit into an envelope under --json', async () => {
    const result = await run(async () => { throw new CommandExit(1, 'failure', 'validation_failed'); }, ['--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ error: { code: 'COMMAND_FAILED' } });
  });
});
