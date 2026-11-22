import type { ProtocolEventWindow, ProtocolEventWindowUnit } from './types.js';

const UNIT_MILLISECONDS: Readonly<Record<ProtocolEventWindowUnit, number>> = Object.freeze({
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
});

const WINDOW_PATTERN = /^([1-9][0-9]{0,8}) (second|minute|hour|day|week)$/;

/**
 * Parse a funnel window (RFC 0027): an integer from 1, one space, and a
 * singular unit. One encoding per window, so `"7 days"` and `"07 day"` are
 * refused rather than normalized. Returns `undefined` for anything else.
 */
export function parseProtocolEventWindow(value: unknown): ProtocolEventWindow | undefined {
  if (typeof value !== 'string') return undefined;
  const match = WINDOW_PATTERN.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2] as ProtocolEventWindowUnit;
  return Object.freeze({ amount, unit, milliseconds: amount * UNIT_MILLISECONDS[unit] });
}
