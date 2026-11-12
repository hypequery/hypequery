import { describe, expect, it } from 'vitest';
import { DeploymentUploadError } from '../deployment-upload.js';
import { PromptCancelledError } from '../prompts.js';
import { CliError } from './cli-error.js';
import { cloudHttpError, toCliError, toDatabaseCliError } from './classify-error.js';
import { parseCloudErrorBody } from './cloud-error-body.js';

function errno(code: string, message = code) {
  return Object.assign(new Error(message), { code });
}

describe('toCliError', () => {
  it('keeps a CliError as it is', () => {
    const error = new CliError('CONFLICT', 'exists');
    expect(toCliError(error)).toBe(error);
  });

  it.each([
    [Object.assign(new Error("error: unknown option '--bogus'"), { code: 'commander.unknownOption' }), 'USAGE', 1],
    [Object.assign(new Error("error: unknown command 'nope'"), { code: 'commander.unknownCommand' }), 'USAGE', 1],
    [Object.assign(new Error('missing required argument'), { code: 'commander.missingArgument' }), 'USAGE', 1],
    [errno('ENOENT', 'no such file'), 'NOT_FOUND', 1],
    [errno('EEXIST'), 'CONFLICT', 1],
    [errno('EACCES'), 'INVALID_INPUT', 1],
    [errno('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:8123'), 'UNAVAILABLE', 4],
    [Object.assign(new TypeError('fetch failed'), { cause: errno('ENOTFOUND') }), 'UNAVAILABLE', 4],
    [Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), 'UNAVAILABLE', 4],
    [new Error('Code: 516. DB::Exception: default: Authentication failed'), 'CONNECTION_AUTH_FAILED', 1],
    [new PromptCancelledError(), 'CANCELLED', 130],
    [new Error('Pass a contract file.'), 'COMMAND_FAILED', 1],
    [new TypeError("Cannot read properties of undefined (reading 'x')"), 'INTERNAL', 5],
    ['a thrown string', 'INTERNAL', 5],
  ])('classifies %s as %s (exit %i)', (error, code, exitCode) => {
    const classified = toCliError(error);
    expect(classified.code).toBe(code);
    expect(classified.exitCode).toBe(exitCode);
  });

  it('maps deployment upload failures by kind and HTTP status', () => {
    expect(toCliError(new DeploymentUploadError('HQ_UPLOAD_NETWORK', 'down')).code).toBe('UNAVAILABLE');
    expect(toCliError(new DeploymentUploadError('HQ_UPLOAD_IDENTITY_MISMATCH', 'mismatch')).code).toBe('INVALID_INPUT');
    expect(toCliError(new DeploymentUploadError('HQ_UPLOAD_REJECTED', 'no', 401)).exitCode).toBe(2);
    expect(toCliError(new DeploymentUploadError('HQ_UPLOAD_REJECTED', 'no', 403)).code).toBe('FORBIDDEN');
    expect(toCliError(new DeploymentUploadError('HQ_UPLOAD_REJECTED', 'no', 402)).exitCode).toBe(3);
    expect(toCliError(new DeploymentUploadError('HQ_UPLOAD_REJECTED', 'no', 409)).code).toBe('STALE_STATE');
    expect(toCliError(new DeploymentUploadError('HQ_UPLOAD_REJECTED', 'no', 503)).exitCode).toBe(4);
    expect(toCliError(new DeploymentUploadError('HQ_UPLOAD_REJECTED', 'no', 422)).code).toBe('CLOUD_REJECTED');
  });

  it('relays Cloud\'s own category, hint and request ID over the status', () => {
    const cloud = parseCloudErrorBody(JSON.stringify({
      error: {
        code: 'PLAN_SEATS_EXCEEDED',
        message: 'Your plan allows 3 projects.',
        hint: 'Upgrade to Team.',
        category: 'budget_exceeded',
        requestId: 'req_abc',
      },
    }));
    const error = toCliError(new DeploymentUploadError('HQ_UPLOAD_REJECTED', 'rejected', 400, cloud));
    expect(error).toMatchObject({ code: 'PLAN_LIMIT', hint: 'Upgrade to Team.', requestId: 'req_abc' });
    expect(error.exitCode).toBe(3);
  });
});

describe('cloudHttpError', () => {
  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [402, 'PLAN_LIMIT'],
    [404, 'NOT_FOUND'],
    [409, 'STALE_STATE'],
    [429, 'UNAVAILABLE'],
    [500, 'UNAVAILABLE'],
    [400, 'CLOUD_REJECTED'],
  ])('maps HTTP %i to %s', (status, code) => {
    expect(cloudHttpError(status, 'failed').code).toBe(code);
  });
});

describe('toDatabaseCliError', () => {
  it('reports an unreachable database as retryable CONNECTION_FAILED, already explained on stderr', () => {
    const error = toDatabaseCliError(errno('ECONNREFUSED', 'connect ECONNREFUSED'));
    expect(error).toMatchObject({ code: 'CONNECTION_FAILED', reported: true });
    expect(error.exitCode).toBe(4);
  });

  it('keeps other classifications', () => {
    expect(toDatabaseCliError(new Error('Authentication failed')).code).toBe('CONNECTION_AUTH_FAILED');
  });
});

describe('parseCloudErrorBody', () => {
  it('reads the envelope, drops unknown categories and unsafe values', () => {
    expect(parseCloudErrorBody('{"error":{"code":"X","message":"a\\u0007b","category":"weird","requestId":"bad id!"}}'))
      .toEqual({ code: 'X', message: 'a b' });
    expect(parseCloudErrorBody('not json')).toEqual({});
    expect(parseCloudErrorBody('{"error":"nope"}')).toEqual({});
  });
});
