import { describe, expect, it } from 'vitest';
import {
  CATEGORY_EXIT_CODES,
  CLI_ERROR_CATEGORIES,
  CLI_ERRORS,
  CLI_EXIT_CODES,
  CliError,
  cliErrorEnvelope,
} from './cli-error.js';

describe('CLI exit codes', () => {
  it('keeps the documented scheme (decision 0019)', () => {
    expect(CLI_EXIT_CODES).toEqual({
      OK: 0,
      USER_CORRECTABLE: 1,
      AUTH: 2,
      PLAN: 3,
      TRANSIENT: 4,
      INTERNAL: 5,
      INTERRUPTED: 130,
      TERMINATED: 143,
    });
  });

  it('maps every category, and so every code, to a documented exit code', () => {
    const documented = new Set<number>(Object.values(CLI_EXIT_CODES));
    for (const category of CLI_ERROR_CATEGORIES) {
      expect(documented.has(CATEGORY_EXIT_CODES[category])).toBe(true);
    }
    expect(CATEGORY_EXIT_CODES.correctable_input).toBe(1);
    expect(CATEGORY_EXIT_CODES.stale_contract).toBe(1);
    expect(CATEGORY_EXIT_CODES.unauthenticated).toBe(2);
    expect(CATEGORY_EXIT_CODES.forbidden).toBe(2);
    expect(CATEGORY_EXIT_CODES.budget_exceeded).toBe(3);
    expect(CATEGORY_EXIT_CODES.unavailable).toBe(4);
    expect(CATEGORY_EXIT_CODES.internal).toBe(5);
    expect(CATEGORY_EXIT_CODES.cancelled).toBe(130);
  });

  it('marks exactly the transient codes retryable', () => {
    const retryable = Object.entries(CLI_ERRORS).filter(([, spec]) => spec.retryable).map(([code]) => code);
    expect(retryable.sort()).toEqual(['CONNECTION_FAILED', 'UNAVAILABLE']);
    for (const code of retryable) {
      expect(CATEGORY_EXIT_CODES[CLI_ERRORS[code as keyof typeof CLI_ERRORS].category]).toBe(CLI_EXIT_CODES.TRANSIENT);
    }
  });
});

describe('cliErrorEnvelope', () => {
  it('has the shape Cloud /v1 and MCP use, plus the exit code', () => {
    const envelope = cliErrorEnvelope(new CliError('INPUT_REQUIRED', 'Pass --style.', {
      issues: [{ path: '--style', message: 'required' }],
    }));
    expect(envelope).toEqual({
      error: {
        code: 'INPUT_REQUIRED',
        message: 'Pass --style.',
        hint: CLI_ERRORS.INPUT_REQUIRED.hint,
        docsUrl: 'https://hypequery.com/docs/reference/api/cli#exit-codes-and-errors',
        category: 'correctable_input',
        retryable: false,
        correctable: true,
        exitCode: 1,
        issues: [{ path: '--style', message: 'required' }],
      },
    });
  });

  it('relays a specific hint and Cloud request ID, and omits empty optional fields', () => {
    const envelope = cliErrorEnvelope(new CliError('UNAVAILABLE', 'Cloud is down.', { hint: 'Retry.', requestId: 'req_1', issues: [] }));
    expect(envelope.error).toMatchObject({ hint: 'Retry.', requestId: 'req_1', retryable: true, correctable: false, exitCode: 4 });
    expect(envelope.error).not.toHaveProperty('issues');
    expect(cliErrorEnvelope(new CliError('INTERNAL', 'bug')).error).not.toHaveProperty('requestId');
  });

  it('is correctable only for correctable_input, as in Cloud', () => {
    expect(cliErrorEnvelope(new CliError('OUT_OF_DATE', 'stale')).error).toMatchObject({ category: 'stale_contract', correctable: false, exitCode: 1 });
    expect(cliErrorEnvelope(new CliError('UNAUTHENTICATED', 'sign in')).error).toMatchObject({ correctable: false, exitCode: 2 });
    expect(cliErrorEnvelope(new CliError('PLAN_LIMIT', 'upgrade')).error).toMatchObject({ category: 'budget_exceeded', exitCode: 3 });
  });
});
