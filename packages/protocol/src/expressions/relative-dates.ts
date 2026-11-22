/**
 * The relative date grammar of the `inDateRange` comparison (RFC 0029).
 *
 * Values are lowercase ASCII words separated by single spaces. Parsing is
 * exact: no trimming, no case folding, no aliases, so every implementation
 * accepts the same strings.
 */

export type ProtocolRelativeDateUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

/** A parsed relative range; see RFC 0029 §2 for the bounds each kind resolves to. */
export type ProtocolRelativeDateRange =
  | { readonly kind: 'today' }
  | { readonly kind: 'yesterday' }
  | { readonly kind: 'this'; readonly unit: ProtocolRelativeDateUnit }
  /** `last <unit>` has count 1; `last N <unit>(s)` has count N. */
  | { readonly kind: 'last'; readonly unit: ProtocolRelativeDateUnit; readonly count: number }
  | { readonly kind: 'toDate'; readonly unit: 'month' | 'quarter' | 'year' };

const UNITS = '(day|week|month|quarter|year)';
const THIS = new RegExp(`^this ${UNITS}$`);
const LAST = new RegExp(`^last ${UNITS}$`);
const LAST_N = new RegExp(`^last ([1-9][0-9]{0,3}) ${UNITS}s?$`);
const TO_DATE = /^(month|quarter|year) to date$/;

/** The parsed range, or `undefined` when `value` is not in the grammar. */
export function parseProtocolRelativeDateRange(value: unknown): ProtocolRelativeDateRange | undefined {
  if (typeof value !== 'string') return undefined;
  if (value === 'today') return { kind: 'today' };
  if (value === 'yesterday') return { kind: 'yesterday' };
  let match = THIS.exec(value);
  if (match) return { kind: 'this', unit: match[1] as ProtocolRelativeDateUnit };
  match = LAST.exec(value);
  if (match) return { kind: 'last', unit: match[1] as ProtocolRelativeDateUnit, count: 1 };
  match = LAST_N.exec(value);
  if (match) return { kind: 'last', unit: match[2] as ProtocolRelativeDateUnit, count: Number(match[1]) };
  match = TO_DATE.exec(value);
  if (match) return { kind: 'toDate', unit: match[1] as 'month' | 'quarter' | 'year' };
  return undefined;
}

/** True when `value` is a relative date range of the RFC 0029 grammar. */
export function isProtocolRelativeDateRange(value: unknown): value is string {
  return parseProtocolRelativeDateRange(value) !== undefined;
}
