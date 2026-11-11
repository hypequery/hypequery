import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliError } from './cli-error.js';
import { EXIT_CODES, exitClassFor } from './exit-codes.js';
import {
  disableJsonOutput,
  emitDefaultResult,
  emitResult,
  enableJsonOutput,
  errorEnvelope,
  isJsonOutput,
} from './machine-output.js';
import { assertCanPrompt } from './prompts.js';

afterEach(() => {
  disableJsonOutput();
  vi.restoreAllMocks();
});

describe('machine output', () => {
  it('prints nothing on stdout in text mode', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    emitResult({ ok: true });
    expect(stdout).not.toHaveBeenCalled();
  });

  it('prints exactly one JSON document and sends logs to stderr', () => {
    const out: string[] = [];
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    enableJsonOutput((text) => out.push(text));

    console.log('human progress');
    emitResult({ releaseIdentity: 'abc' });
    emitDefaultResult();

    expect(isJsonOutput()).toBe(true);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({ releaseIdentity: 'abc' });
    expect(stderr).toHaveBeenCalledWith('human progress');
  });

  it('builds the error envelope from a CliError', () => {
    const error = new CliError('CLOUD_NOT_SIGNED_IN', 'Missing deployment credential.', {
      hint: 'Run `hypequery login`.',
      exitClass: 'auth',
    });
    expect(errorEnvelope(error, error.exitClass, 'AUTH_FAILED')).toEqual({
      error: {
        code: 'CLOUD_NOT_SIGNED_IN',
        message: 'Missing deployment credential.',
        hint: 'Run `hypequery login`.',
        category: 'unauthorized',
        retryable: false,
        correctable: false,
        exitCode: EXIT_CODES.auth,
      },
    });
  });

  it('falls back to the telemetry code for an unclassified error', () => {
    expect(errorEnvelope(new Error('fetch failed'), 'transient', 'CONNECTION_FAILED').error).toMatchObject({
      code: 'CONNECTION_FAILED',
      category: 'unavailable',
      retryable: true,
      exitCode: EXIT_CODES.transient,
    });
  });
});

describe('exit classes', () => {
  it('maps auth and network failures to their fixed codes', () => {
    expect(exitClassFor('auth_failed')).toBe('auth');
    expect(exitClassFor('connection_failed')).toBe('transient');
    expect(exitClassFor('cloud_network_error')).toBe('transient');
  });

  it('keeps unclassified failures correctable and programming errors internal', () => {
    expect(exitClassFor('validation_failed')).toBe('correctable');
    expect(exitClassFor('unknown', new Error('Unknown action'))).toBe('correctable');
    expect(exitClassFor('unknown', new TypeError('x is undefined'))).toBe('internal');
  });
});

describe('assertCanPrompt', () => {
  it('allows prompts at a terminal', () => {
    expect(() => assertCanPrompt({ isTTY: true })).not.toThrow();
  });

  it('refuses prompts without a terminal', () => {
    expect(() => assertCanPrompt({ isTTY: false })).toThrow(
      expect.objectContaining({ code: 'INPUT_REQUIRED' }),
    );
  });

  it('refuses prompts in --json mode even at a terminal', () => {
    enableJsonOutput(() => undefined);
    expect(() => assertCanPrompt({ isTTY: true })).toThrow(
      expect.objectContaining({ code: 'INPUT_REQUIRED' }),
    );
  });
});
