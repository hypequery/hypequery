import { DateRange } from 'react-day-picker';
import type { FiltersInput } from '@/analytics/filters';

const serializeRange = (range?: DateRange): { from?: string; to?: string } | undefined => {
  if (!range) return undefined;
  const from = range.from ? range.from.toISOString() : undefined;
  const to = range.to ? range.to.toISOString() : undefined;
  if (!from && !to) return undefined;
  return { from, to };
};

export const buildFilterInput = (
  pickupDateRange?: DateRange,
  dropoffDateRange?: DateRange,
): FiltersInput => ({
  pickupDateRange: serializeRange(pickupDateRange),
  dropoffDateRange: serializeRange(dropoffDateRange),
});
