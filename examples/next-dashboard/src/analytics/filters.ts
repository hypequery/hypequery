import { CrossFilter } from '@hypequery/clickhouse';
import { endOfDay, startOfDay, format } from 'date-fns';
import { z } from 'zod';

export const dateRangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const filtersSchema = z
  .object({
    pickupDateRange: dateRangeSchema.optional(),
    dropoffDateRange: dateRangeSchema.optional(),
  })
  .default({});

export type FiltersInput = z.infer<typeof filtersSchema>;

const formatDate = (value: string | undefined, start: boolean) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const normalized = start ? startOfDay(date) : endOfDay(date);
  return format(normalized, 'yyyy-MM-dd HH:mm:ss');
};

export const buildCrossFilter = (filters?: FiltersInput) => {
  const crossFilter = new CrossFilter();
  if (!filters) return crossFilter;

  const pickupFrom = formatDate(filters.pickupDateRange?.from, true);
  const pickupTo = formatDate(filters.pickupDateRange?.to, false);
  if (pickupFrom) {
    crossFilter.add({ column: 'pickup_datetime', operator: 'gte', value: pickupFrom });
  }
  if (pickupTo) {
    crossFilter.add({ column: 'pickup_datetime', operator: 'lte', value: pickupTo });
  }

  const dropoffFrom = formatDate(filters.dropoffDateRange?.from, true);
  const dropoffTo = formatDate(filters.dropoffDateRange?.to, false);
  if (dropoffFrom) {
    crossFilter.add({ column: 'dropoff_datetime', operator: 'gte', value: dropoffFrom });
  }
  if (dropoffTo) {
    crossFilter.add({ column: 'dropoff_datetime', operator: 'lte', value: dropoffTo });
  }

  return crossFilter;
};
