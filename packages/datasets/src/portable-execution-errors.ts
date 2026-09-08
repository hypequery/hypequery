/**
 * An error that deliberately claims a portable failure category.
 *
 * A data plane forwards the category and message of an error carrying this
 * marker instead of reporting a generic executor failure, so the marker — not
 * the shape of the error — is what grants that. A provider exception cannot
 * acquire one by accident, which is the point: the two packages are siblings
 * and cannot share a class, but a raw driver error must never be able to pass
 * itself off as a deliberate claim and put its own message in front of a
 * caller.
 *
 * Deliberately not exported. The three errors below are, because this package's
 * own executor throws them; this base is only how they share the marker. A
 * supported way for someone else's executor to claim a category belongs beside
 * the data plane that honours it, not beside one implementation of the slot it
 * fills.
 */
abstract class PortableExecutionError extends Error {
  /** The opt-in a data plane checks before trusting anything below it. */
  readonly hypequerySemanticFailure = true as const;
  abstract readonly code: string;
  abstract readonly category: string;
}

/** Signalled when portable execution cannot faithfully serve a target. */
export class PortableExecutionUnsupportedError extends PortableExecutionError {
  readonly code = 'HQ_SEMANTIC_UNSUPPORTED_CAPABILITY';
  readonly category = 'unsupported-capability';

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = 'PortableExecutionUnsupportedError';
  }
}

export class PortableExecutionBudgetError extends PortableExecutionError {
  readonly code = 'HQ_SEMANTIC_BUDGET_EXCEEDED';
  readonly category = 'budget-exceeded';

  constructor(message: string) {
    super(message);
    this.name = 'PortableExecutionBudgetError';
  }
}

/**
 * Signalled when tenancy cannot be enforced for a call that resolved a tenant.
 *
 * `configuration-invalid` rather than a caller-facing category: nothing the
 * caller sent is wrong, and nothing it can send would make the call succeed.
 */
export class PortableExecutionTenantError extends PortableExecutionError {
  readonly code = 'HQ_SEMANTIC_TENANT_UNENFORCEABLE';
  readonly category = 'configuration-invalid';

  constructor(message: string) {
    super(message);
    this.name = 'PortableExecutionTenantError';
  }
}

