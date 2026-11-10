import { dataset, dimension, measure } from '@hypequery/datasets';

/**
 * Events bucketed into ISO 8601 weeks: Monday to Sunday, numbered so that
 * week 1 is the week containing the year's first Thursday. Two dimensions
 * carry the week, and both are needed:
 *
 * - `isoWeekStart` is the Monday (`toMonday`), a real date you can sort, join
 *   and chart on a time axis.
 * - `isoWeek` is the label (`%G-W%V`): ISO year plus ISO week number. `%G` is
 *   the ISO year, which differs from the calendar year (`%Y`) for up to three
 *   days at each end of the year.
 *
 * The dataset's built-in `by: 'week'` grain renders `toStartOfWeek(x)`, mode
 * 0, which starts weeks on Sunday. Use these dimensions when you want ISO weeks.
 */
export const Events = dataset('events', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    userId: dimension.number({ column: 'user_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    isoWeekStart: dimension.timestamp({
      sql: 'toMonday(occurred_at)',
      dependencies: ['occurred_at'],
      label: 'ISO week (Monday)',
    }),
    isoWeek: dimension.string({
      sql: "formatDateTime(occurred_at, '%G-W%V')",
      dependencies: ['occurred_at'],
      label: 'ISO week label',
    }),
  },
  measures: {
    events: measure.count('eventId', { label: 'Events' }),
    activeUsers: measure.countDistinct('userId', { label: 'Active users' }),
    firstEventAt: measure.min('occurredAt', { label: 'First event' }),
    lastEventAt: measure.max('occurredAt', { label: 'Last event' }),
  },
});
