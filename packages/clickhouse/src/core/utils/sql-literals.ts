const INTERVAL_UNITS: Record<string, string> = {
  second: 'SECOND',
  seconds: 'SECOND',
  minute: 'MINUTE',
  minutes: 'MINUTE',
  hour: 'HOUR',
  hours: 'HOUR',
  day: 'DAY',
  days: 'DAY',
  week: 'WEEK',
  weeks: 'WEEK',
  month: 'MONTH',
  months: 'MONTH',
  quarter: 'QUARTER',
  quarters: 'QUARTER',
  year: 'YEAR',
  years: 'YEAR',
  millisecond: 'MILLISECOND',
  milliseconds: 'MILLISECOND',
  microsecond: 'MICROSECOND',
  microseconds: 'MICROSECOND',
  nanosecond: 'NANOSECOND',
  nanoseconds: 'NANOSECOND',
};

const INTERVAL_PATTERN = /^(\d+)\s+([a-z]+)$/i;

export function formatIntervalLiteral(interval: string): string {
  const normalized = interval.trim();
  const match = normalized.match(INTERVAL_PATTERN);
  const unit = match ? INTERVAL_UNITS[match[2].toLowerCase()] : undefined;

  if (!match || !unit) {
    throw new Error(
      `Invalid time interval: "${interval}". Expected "<number> <unit>" where unit is ` +
      'one of second, minute, hour, day, week, month, quarter, year, millisecond, microsecond, nanosecond ' +
      '(e.g. "1 day", "15 minute").',
    );
  }

  return `${match[1]} ${unit}`;
}

export function quoteStringLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}
