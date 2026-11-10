/**
 * Decimal-safe money: amounts are BigInt counts of 1/10,000 of a currency
 * unit, so `0.0125 * 171` is exact and nothing passes through a float.
 * ClickHouse returns Decimal and UInt64 as strings; parse those directly.
 */
const SCALE = 4;
const FACTOR = 10n ** BigInt(SCALE);

export function toUnits(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`not a decimal: "${value}"`);
  const [, sign, whole, frac = ''] = match;
  if (frac.length > SCALE) throw new Error(`more than ${SCALE} decimal places: "${value}"`);
  const units = BigInt(whole) * FACTOR + BigInt(frac.padEnd(SCALE, '0'));
  return sign ? -units : units;
}

/** Price per unit times an integer quantity. */
export function times(unitPrice: string, quantity: number | bigint): bigint {
  return toUnits(unitPrice) * BigInt(quantity);
}

/** Round to cents, half away from zero (the usual invoice rule). */
export function roundToCents(units: bigint): bigint {
  const step = FACTOR / 100n;
  const half = step / 2n;
  const abs = units < 0n ? -units : units;
  const rounded = ((abs + half) / step) * step;
  return units < 0n ? -rounded : rounded;
}

/** "1234.5000" -> "1234.50". Always two decimals. */
export function format(units: bigint): string {
  const cents = roundToCents(units) / (FACTOR / 100n);
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
