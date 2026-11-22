/** RFC 0027 ceilings. Products may lower but not raise them. */
export const PROTOCOL_EVENT_OPERATION_LIMITS = Object.freeze({
  minSteps: 2,
  maxSteps: 10,
  maxConditions: 10,
  maxBreakdown: 3,
  maxBreakdownLimit: 100,
  defaultBreakdownLimit: 25,
  maxWindowMilliseconds: 365 * 86_400_000,
  maxRangeDays: 731,
  maxPeriods: 52,
});

/** Output columns retention always emits; a breakdown dimension can't reuse one. */
export const PROTOCOL_RETENTION_COLUMNS: ReadonlySet<string> = new Set([
  'cohort', 'period', 'entities', 'retained', 'rate',
]);

/** Output columns a funnel always emits; a breakdown dimension can't reuse one. */
export const PROTOCOL_FUNNEL_COLUMNS: ReadonlySet<string> = new Set([
  'cohort', 'step', 'step_index', 'entities',
  'conversion_from_previous', 'conversion_from_first', 'dropoff',
]);
