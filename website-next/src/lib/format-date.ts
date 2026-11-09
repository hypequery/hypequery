/** Formats an ISO date as "November 8, 2026", in UTC so the day never shifts. */
export function formatLongDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
