import { PROTOCOL_EVENT_OPERATION_LIMITS as LIMITS, PROTOCOL_FUNNEL_COLUMNS } from '@hypequery/protocol';
import type { EventOperationSpec } from './event-operation-spec.js';

const COHORT_GRAINS = new Set(['day', 'week', 'month']);

/**
 * The RFC 0027 shape rules the protocol validator applies, for specs built
 * directly in code: bounds, unique names, and breakdown names that can't
 * collide with an output column (which would overwrite the breakdown value).
 */
export function eventOperationShapeErrors(spec: EventOperationSpec): string[] {
  const errors: string[] = [];
  const reserved = PROTOCOL_FUNNEL_COLUMNS;
  if (spec.breakdown.length > LIMITS.maxBreakdown) {
    errors.push(`At most ${LIMITS.maxBreakdown} breakdown dimensions may be used.`);
  }
  if (new Set(spec.breakdown).size !== spec.breakdown.length) errors.push('Breakdown dimensions must be unique.');
  for (const name of spec.breakdown) {
    if (reserved.has(name)) errors.push(`Breakdown dimension "${name}" collides with the "${name}" output column.`);
  }
  if (!Number.isSafeInteger(spec.breakdownLimit) || spec.breakdownLimit < 1 || spec.breakdownLimit > LIMITS.maxBreakdownLimit) {
    errors.push(`breakdownLimit must be an integer from 1 to ${LIMITS.maxBreakdownLimit}.`);
  }
  if (spec.steps.length < LIMITS.minSteps || spec.steps.length > LIMITS.maxSteps) {
    errors.push(`A funnel has ${LIMITS.minSteps} to ${LIMITS.maxSteps} steps.`);
  }
  if (new Set(spec.steps.map(step => step.name)).size !== spec.steps.length) errors.push('Step names must be unique.');
  for (const step of spec.steps) {
    if (step.where.length < 1 || step.where.length > LIMITS.maxConditions) {
      errors.push(`Step "${step.name}" needs 1 to ${LIMITS.maxConditions} conditions.`);
    }
  }
  if (!Number.isSafeInteger(spec.windowMs) || spec.windowMs < 1 || spec.windowMs > LIMITS.maxWindowMilliseconds) {
    errors.push('The funnel window must be a whole number of milliseconds, at most 365 days.');
  }
  if (spec.by !== undefined && !COHORT_GRAINS.has(spec.by)) errors.push(`Cohort grain "${spec.by}" is not day, week or month.`);
  return errors;
}
