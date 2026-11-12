import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliError } from './cli-error.js';
import { EXIT_CODES, exitClassFor, exitClassForCode } from './exit-codes.js';
import { telemetryErrorCode } from './telemetry/error-code.js';
import { DeploymentUploadError } from './deployment-upload.js';
import {
  disableJsonOutput,
  childProcessStdio,
  emitDefaultResult,
  emitJsonText,
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

  it('prints preserialized JSON once, ending in a newline', () => {
    const out: string[] = [];
    enableJsonOutput((text) => out.push(text));
    emitJsonText('{"a":1}');
    emitDefaultResult();
    expect(out).toEqual(['{"a":1}\n']);
  });

  it('sends child process output to stderr only in --json mode', () => {
    expect(childProcessStdio()).toBe('inherit');
    enableJsonOutput(() => undefined);
    expect(childProcessStdio()).toEqual(['ignore', 2, 2]);
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

  it('maps numeric exit codes back to their class', () => {
    expect(exitClassForCode(2)).toBe('auth');
    expect(exitClassForCode(4)).toBe('transient');
    expect(exitClassForCode(1)).toBe('correctable');
    expect(exitClassForCode(42)).toBe('correctable');
  });

  it('treats upload network failures and timeouts as transient', () => {
    expect(exitClassFor(telemetryErrorCode(new DeploymentUploadError('HQ_UPLOAD_NETWORK', 'request failed')))).toBe('transient');
    expect(exitClassFor(telemetryErrorCode(new DeploymentUploadError('HQ_UPLOAD_REJECTED', 'refused', 503)))).toBe('transient');
    expect(exitClassFor(telemetryErrorCode(new DeploymentUploadError('HQ_UPLOAD_REJECTED', 'refused', 401)))).toBe('auth');
    expect(telemetryErrorCode(new DeploymentUploadError('HQ_UPLOAD_REJECTED', 'bad bundle', 422))).toBe('cloud_rejected');
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    expect(exitClassFor(telemetryErrorCode(timeout))).toBe('transient');
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
