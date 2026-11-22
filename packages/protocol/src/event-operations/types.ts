import type { ProtocolExpression } from '../expressions/index.js';
import type { ProtocolIdentifier } from '../identifiers/index.js';

/** Units a funnel `window` may use (RFC 0027). Months have no fixed length. */
export type ProtocolEventWindowUnit = 'second' | 'minute' | 'hour' | 'day' | 'week';

/** Grains for cohorts: a funnel's `by` and retention's `grain` (RFC 0027). */
export type ProtocolEventCohortGrain = 'day' | 'week' | 'month';

/** A parsed funnel window, such as `"7 day"`. */
export interface ProtocolEventWindow {
  readonly amount: number;
  readonly unit: ProtocolEventWindowUnit;
  readonly milliseconds: number;
}

/** One funnel step: a name for the result rows and AND-combined conditions. */
export interface ProtocolFunnelStep {
  readonly name: ProtocolIdentifier;
  readonly where: readonly ProtocolExpression[];
}

interface ProtocolEventOperationCommon {
  readonly dataset: ProtocolIdentifier;
  /** The dimension whose distinct values are counted; defaults to `events.entity`. */
  readonly entity?: ProtocolIdentifier;
  /**
   * AND-combined predicates applied to every event. Must contain exactly one
   * bounded range on the dataset's time field, which the data plane checks.
   */
  readonly filters: readonly ProtocolExpression[];
  /** Events are partitioned by these dimensions' values. */
  readonly breakdown?: readonly ProtocolIdentifier[];
  /** How many breakdown groups to return, ranked by size. Default 25. */
  readonly breakdownLimit?: number;
  /** IANA zone from RFC 0018's pinned registry (RFC 0025). Absent means UTC. */
  readonly timezone?: string;
}

/**
 * A funnel (RFC 0027): of the entities that did step 1, how many went on to
 * do each later step within `window`.
 */
export interface ProtocolFunnelOperation extends ProtocolEventOperationCommon {
  readonly kind: 'funnel';
  readonly steps: readonly ProtocolFunnelStep[];
  /** `"<N> <unit>"`, such as `"7 day"`. */
  readonly window: string;
  /** `strict` (the default) is ordered; `any` accepts the steps in any order. */
  readonly order?: 'strict' | 'any';
  /** Report conversion per cohort of each entity's first step-1 event. */
  readonly by?: ProtocolEventCohortGrain;
}

/** What puts an entity into a cohort, or counts as its return. */
export interface ProtocolRetentionCondition {
  readonly where: readonly ProtocolExpression[];
}

/**
 * Retention (RFC 0027): entities enter the cohort of the bucket holding their
 * first `start` event; each period reports how many had a `return` event in
 * the bucket `cohort + period`.
 */
export interface ProtocolRetentionOperation extends ProtocolEventOperationCommon {
  readonly kind: 'retention';
  readonly start: ProtocolRetentionCondition;
  readonly return: ProtocolRetentionCondition;
  readonly grain: ProtocolEventCohortGrain;
  /** Periods after the cohort to report, 1–52. */
  readonly periods: number;
}

/** An operation over an event dataset (RFC 0027). */
export type ProtocolEventOperation = ProtocolFunnelOperation | ProtocolRetentionOperation;

export type ProtocolEventOperationKind = ProtocolEventOperation['kind'];
