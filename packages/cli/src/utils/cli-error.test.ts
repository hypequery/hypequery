import { describe, expect, it } from 'vitest';
import { CLI_ERROR_CATEGORIES, CliError, cloudHttpError, outOfDateError, outputConflictError } from './cli-error.js';
import { parseCloudErrorBody } from './cloud-error-body.js';
import { errorEnvelope } from './machine-output.js';
import { EXIT_CODES } from './exit-codes.js';

describe('CliError categories (decision 0003)', () => {
  it('defaults the category from the exit class and the exit class from the category', () => {
    expect(new CliError('X', 'x').category).toBe('correctable_input');
    expect(new CliError('X', 'x', { exitClass: 'auth' }).category).toBe('unauthenticated');
    expect(new CliError('X', 'x', { exitClass: 'plan' }).category).toBe('budget_exceeded');
    expect(new CliError('X', 'x', { exitClass: 'transient' }).category).toBe('unavailable');
    expect(new CliError('X', 'x', { category: 'forbidden' }).exitClass).toBe('auth');
    expect(new CliError('X', 'x', { category: 'stale_contract' }).exitClass).toBe('correctable');
    expect(CLI_ERROR_CATEGORIES).toHaveLength(9);
  });

  it('reports drift and refused overwrites with the files involved', () => {
    const stale = outOfDateError('stale', [{ path: 'a.ts', missing: true }, { path: 'b.ts', missing: false }], 'Run it.');
    expect(stale).toMatchObject({ code: 'OUT_OF_DATE', category: 'stale_contract', exitClass: 'correctable', telemetryCode: 'output_out_of_date' });
    expect(stale.issues).toEqual([{ path: 'a.ts', message: 'missing' }, { path: 'b.ts', message: 'out of date' }]);
    expect(outputConflictError('exists', ['c.ts'])).toMatchObject({ code: 'OUTPUT_EXISTS', issues: [{ path: 'c.ts' }] });
  });
});

describe('cloudHttpError', () => {
  it.each([
    [401, 'CLOUD_UNAUTHORIZED', 'unauthenticated', EXIT_CODES.auth],
    [403, 'CLOUD_UNAUTHORIZED', 'forbidden', EXIT_CODES.auth],
    [402, 'CLOUD_PLAN_LIMIT', 'budget_exceeded', EXIT_CODES.plan],
    [409, 'CLOUD_STATE_CHANGED', 'stale_contract', EXIT_CODES.correctable],
    [429, 'CLOUD_UNAVAILABLE', 'unavailable', EXIT_CODES.transient],
    [503, 'CLOUD_UNAVAILABLE', 'unavailable', EXIT_CODES.transient],
    [422, 'CLOUD_REQUEST_FAILED', 'correctable_input', EXIT_CODES.correctable],
  ])('maps HTTP %i to %s', (status, code, category, exitCode) => {
    const error = cloudHttpError(status, 'failed');
    expect(error).toMatchObject({ code, category });
    expect(EXIT_CODES[error.exitClass]).toBe(exitCode);
  });

  it('relays Cloud\'s category, hint and request ID over the status', () => {
    const cloud = parseCloudErrorBody(JSON.stringify({
      error: { code: 'PLAN_LIMIT', message: 'Three projects.', hint: 'Upgrade to Team.', category: 'budget_exceeded', requestId: 'req_1' },
    }));
    const error = cloudHttpError(400, 'Rejected.', cloud);
    expect(error).toMatchObject({ code: 'CLOUD_PLAN_LIMIT', hint: 'Upgrade to Team.', requestId: 'req_1', exitClass: 'plan' });
    expect(errorEnvelope(error, error.exitClass, 'X').error).toMatchObject({ requestId: 'req_1', category: 'budget_exceeded', exitCode: 3 });
  });

  it('treats a Cloud internal error as transient for the CLI', () => {
    expect(cloudHttpError(500, 'boom', { category: 'internal' }).exitClass).toBe('transient');
  });
});

describe('parseCloudErrorBody', () => {
  it('drops unknown categories, unsafe request IDs and control characters', () => {
    expect(parseCloudErrorBody('{"error":{"hint":"a\\u0007b","category":"weird","requestId":"bad id!"}}')).toEqual({ hint: 'a b' });
    expect(parseCloudErrorBody('not json')).toEqual({});
    expect(parseCloudErrorBody('{"error":"nope"}')).toEqual({});
  });
});

describe('errorEnvelope', () => {
  it('always names a next action and the docs, and is correctable only for correctable_input', () => {
    const plain = errorEnvelope(new Error('boom'), 'transient', 'CONNECTION_FAILED').error;
    expect(plain).toMatchObject({ hint: 'Retry in a moment.', docsUrl: expect.stringContaining('#exit-codes-and-errors'), correctable: false });
    const stale = errorEnvelope(outOfDateError('stale', [{ path: 'a.ts', missing: false }], 'Regenerate.'), 'correctable', 'X').error;
    expect(stale).toMatchObject({ category: 'stale_contract', correctable: false, exitCode: 1, issues: [{ path: 'a.ts' }] });
  });
});
