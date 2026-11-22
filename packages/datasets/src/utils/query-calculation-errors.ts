/** Thrown when a calculation names a kind or field this executor cannot run yet. */
export class UnsupportedQueryCalculationError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join('; '));
    this.name = 'UnsupportedQueryCalculationError';
  }
}
