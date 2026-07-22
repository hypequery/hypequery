import { CompiledQueryError } from './errors.js';
import type { CompiledDeadline, CompiledSettings } from './types.js';

/**
 * Closed, typed settings allow-list (RFC 0010 §Settings). Each entry defines an inclusive
 * range; products may TIGHTEN a range but never loosen it. Settings originate only from
 * trusted components — a request can never set, override, or relax them.
 */
export interface SettingBound {
  readonly min: number;
  readonly max: number;
}

export const COMPILED_SETTING_BOUNDS = Object.freeze({
  maxExecutionMs: { min: 1, max: 3_600_000 },
  maxResultRows: { min: 0, max: 1_000_000_000_000 },
  maxResultBytes: { min: 0, max: 1_099_511_627_776 },
} as const satisfies Record<keyof CompiledSettings, SettingBound>);

export type CompiledSettingName = keyof typeof COMPILED_SETTING_BOUNDS;

/**
 * Clamp trusted settings into the allow-list. A value outside the closed range is
 * rejected fail-closed rather than silently coerced, since settings are trusted input and
 * an out-of-range value signals a policy bug, not caller data.
 */
export function resolveCompiledSettings(input: CompiledSettings): CompiledSettings {
  const resolved: { -readonly [K in CompiledSettingName]?: number } = {};
  for (const key of Object.keys(COMPILED_SETTING_BOUNDS) as CompiledSettingName[]) {
    const value = input[key];
    if (value === undefined) continue;
    const bound = COMPILED_SETTING_BOUNDS[key];
    if (!Number.isInteger(value) || value < bound.min || value > bound.max) {
      throw new CompiledQueryError(
        'input-invalid',
        `Setting ${key} is outside its allowed range.`
      );
    }
    resolved[key] = value;
  }
  return resolved;
}

export interface DeadlineInputs {
  /** Absolute caller-supplied deadline, epoch-millis. */
  readonly callerAtEpochMs?: number;
  /** Policy-derived maximum window from `now`, milliseconds. */
  readonly policyMaxMs?: number;
  /** Current time, epoch-millis. Injected so resolution stays deterministic/testable. */
  readonly nowEpochMs: number;
}

/**
 * Resolve the effective deadline (RFC 0010 §Deadline and cancellation precedence).
 *
 * The effective deadline is the EARLIER of the caller-supplied deadline and the
 * policy-derived maximum — a caller can shorten but never extend the window. A supplied
 * deadline at or before `now` fails immediately with `deadline-exceeded` rather than being
 * extended or ignored.
 */
export function resolveCompiledDeadline(inputs: DeadlineInputs): CompiledDeadline | undefined {
  const { callerAtEpochMs, policyMaxMs, nowEpochMs } = inputs;

  const policyAt =
    policyMaxMs === undefined ? undefined : nowEpochMs + policyMaxMs;

  if (callerAtEpochMs !== undefined && callerAtEpochMs <= nowEpochMs) {
    throw new CompiledQueryError(
      'deadline-exceeded',
      'The supplied deadline is at or before the current time.'
    );
  }

  if (callerAtEpochMs === undefined && policyAt === undefined) {
    return undefined;
  }
  if (callerAtEpochMs === undefined) {
    return { atEpochMs: policyAt as number, source: 'policy' };
  }
  if (policyAt === undefined) {
    return { atEpochMs: callerAtEpochMs, source: 'caller' };
  }
  return callerAtEpochMs <= policyAt
    ? { atEpochMs: callerAtEpochMs, source: 'caller' }
    : { atEpochMs: policyAt, source: 'policy' };
}
