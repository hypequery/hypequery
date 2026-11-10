/**
 * Billing periods are calendar months in UTC, as half-open intervals:
 * an event at exactly 00:00:00 on the 1st lands in exactly one invoice.
 */
export interface Period {
  /** "2026-09" */
  id: string;
  /** "2026-09-01", inclusive */
  start: string;
  /** "2026-10-01", exclusive */
  end: string;
}

export function billingPeriod(id: string): Period {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(id);
  if (!match) throw new Error(`period must look like "2026-09", got "${id}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  return { id, start: `${id}-01`, end: `${next}-01` };
}

export function currentPeriodId(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** The first day of each of the `count` months ending with `lastPeriodId`. */
export function monthStarts(lastPeriodId: string, count: number): string[] {
  const [year, month] = billingPeriod(lastPeriodId).id.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1));
    return d.toISOString().slice(0, 10);
  });
}
