import { ProtocolQueryImplementationError } from '../query-implementations/errors.js';
import { ProtocolDeploymentError } from './errors.js';
import type { ProtocolDeploymentCheckResult, ProtocolDeploymentValidationError } from './types.js';

/** Collection stops here so a hostile contract cannot make the report unbounded. */
export const MAX_COLLECTED_DEPLOYMENT_ERRORS = 100;

/** Thrown to abandon a subtree whose later checks would only repeat its earlier failures. */
class CollectionAborted extends Error {}

/**
 * Records validation failures instead of stopping at the first. Each
 * `attempt` is a recovery point: a failure inside it is recorded and the
 * caller carries on with the next independent part of the contract.
 */
export class DeploymentErrorCollector {
  readonly errors: ProtocolDeploymentValidationError[] = [];
  truncated = false;
  private readonly seen = new Set<string>();

  get count(): number {
    return this.errors.length;
  }

  record(error: ProtocolDeploymentValidationError): void {
    // Nested validators can re-check a field their caller already rejected.
    const key = `${error.code}\0${error.path}`;
    if (this.seen.has(key)) return;
    if (this.errors.length >= MAX_COLLECTED_DEPLOYMENT_ERRORS) {
      this.truncated = true;
      return;
    }
    this.seen.add(key);
    this.errors.push(error);
  }

  /** Stop this subtree when anything failed since `since`; later checks would cascade. */
  checkpoint(since: number): void {
    if (this.errors.length > since || this.truncated) throw new CollectionAborted();
  }
}

/** Without a collector this is the action itself, so first-error behavior is unchanged. */
export function attempt<T>(
  issues: DeploymentErrorCollector | undefined,
  action: () => T,
): T | undefined {
  if (!issues) return action();
  if (issues.truncated) return undefined;
  try {
    return action();
  } catch (error) {
    if (error instanceof CollectionAborted) return undefined;
    if (error instanceof ProtocolDeploymentError || error instanceof ProtocolQueryImplementationError) {
      issues.record(error);
      return undefined;
    }
    throw error;
  }
}

/** Run a validator with a fresh collector and package what it found. */
export function collectErrors<T>(
  validate: (issues: DeploymentErrorCollector) => T,
): ProtocolDeploymentCheckResult<T> {
  const issues = new DeploymentErrorCollector();
  const value = attempt(issues, () => validate(issues));
  if (issues.count > 0 || issues.truncated) {
    return Object.freeze({
      ok: false,
      errors: Object.freeze([...issues.errors]),
      truncated: issues.truncated,
    });
  }
  return Object.freeze({ ok: true, value: value as T });
}
