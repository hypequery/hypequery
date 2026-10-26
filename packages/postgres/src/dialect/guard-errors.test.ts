import { describe, expect, it } from 'vitest';
import { guardMessage, toGuardError } from './guard-errors.js';

describe('guard errors', () => {
  const pgError = (message: string, code = '22P02') => Object.assign(new Error(message), { code });

  it('recovers the planner message from the failed cast', () => {
    const error = pgError('invalid input syntax for type integer: "[hypequery] Window series exceeds the effective result limit of 3 buckets."');
    expect(guardMessage(error)).toBe('Window series exceeds the effective result limit of 3 buckets.');
    const mapped = toGuardError(error) as Error;
    expect(mapped.message).toBe('Window series exceeds the effective result limit of 3 buckets.');
    expect(mapped.cause).toBe(error);
  });

  it('passes other errors through', () => {
    const cast = pgError('invalid input syntax for type integer: "abc"');
    expect(toGuardError(cast)).toBe(cast);
    const other = pgError('invalid input syntax for type integer: "[hypequery] x"', '42601');
    expect(toGuardError(other)).toBe(other);
    expect(toGuardError('text')).toBe('text');
  });
});
