const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** `YYYY-MM-DD HH:MM:SS` in UTC, the format ClickHouse parses for DateTime. */
export function formatDateTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** `YYYY-MM-DD` in UTC. */
export function formatDate(epochSeconds: number): string {
  return formatDateTime(epochSeconds).slice(0, 10);
}

/** Epoch seconds for a UTC calendar date. */
export function utcSeconds(year: number, month: number, day: number, hour = 0): number {
  return Date.UTC(year, month - 1, day, hour) / 1000;
}

/** Cents to a `Decimal(12, 2)` literal string such as `"49.00"`. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${pad(abs % 100)}`;
}
