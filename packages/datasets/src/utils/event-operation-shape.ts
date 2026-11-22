import {
  PROTOCOL_EVENT_OPERATION_LIMITS as LIMITS,
  PROTOCOL_FUNNEL_COLUMNS,
  PROTOCOL_RETENTION_COLUMNS,
} from '@hypequery/protocol';
import type { EventOperationSpec, FunnelSpec, RetentionSpec } from './event-operation-spec.js';

const COHORT_GRAINS = new Set(['day', 'week', 'month']);

/**
 * The RFC 0027 shape rules the protocol validator applies, for specs built
 * directly in code: bounds, unique names, and breakdown names that can't
 * collide with an output column (which would overwrite the breakdown value).
 */
export function eventOperationShapeErrors(spec: EventOperationSpec): string[] {
  const errors: string[] = [];
  const reserved = spec.kind === 'retention' ? PROTOCOL_RETENTION_COLUMNS : PROTOCOL_FUNNEL_COLUMNS;
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
  // Each kind checks only its own fields, so a new kind can't read another's.
  switch (spec.kind) {
    case 'funnel':
      errors.push(...funnelShapeErrors(spec));
      break;
    case 'retention':
      errors.push(...retentionShapeErrors(spec));
      break;
  }
  return errors;
}

function conditionErrors(name: string, where: readonly unknown[]): string[] {
  return where.length < 1 || where.length > LIMITS.maxConditions
    ? [`${name} needs 1 to ${LIMITS.maxConditions} conditions.`]
    : [];
}

function funnelShapeErrors(spec: FunnelSpec): string[] {
  const errors: string[] = [];
  if (spec.steps.length < LIMITS.minSteps || spec.steps.length > LIMITS.maxSteps) {
    errors.push(`A funnel has ${LIMITS.minSteps} to ${LIMITS.maxSteps} steps.`);
  }
  if (new Set(spec.steps.map(step => step.name)).size !== spec.steps.length) errors.push('Step names must be unique.');
  for (const step of spec.steps) errors.push(...conditionErrors(`Step "${step.name}"`, step.where));
  if (!Number.isSafeInteger(spec.windowMs) || spec.windowMs < 1 || spec.windowMs > LIMITS.maxWindowMilliseconds) {
    errors.push('The funnel window must be a whole number of milliseconds, at most 365 days.');
  }
  if (spec.by !== undefined && !COHORT_GRAINS.has(spec.by)) errors.push(`Cohort grain "${spec.by}" is not day, week or month.`);
  return errors;
}

function retentionShapeErrors(spec: RetentionSpec): string[] {
  const errors = [
    ...conditionErrors('The start condition', spec.start),
    ...conditionErrors('The return condition', spec.return),
  ];
  if (!Number.isSafeInteger(spec.periods) || spec.periods < 1 || spec.periods > LIMITS.maxPeriods) {
    errors.push(`periods must be an integer from 1 to ${LIMITS.maxPeriods}.`);
  }
  if (!COHORT_GRAINS.has(spec.grain)) errors.push(`Cohort grain "${spec.grain}" is not day, week or month.`);
  return errors;
}
