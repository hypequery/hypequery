import type { ProtocolSemanticInvocationFailure, ProtocolSemanticInvocationFailureCategory } from '@hypequery/protocol';

/** A failure that already carries the public category a caller should see. */
export class DeploymentSemanticInvocationError extends Error {
  readonly category: ProtocolSemanticInvocationFailureCategory;
  readonly code: string;
  readonly path?: string;
  readonly retryable: boolean;
  readonly relist: boolean;

  constructor(
    category: ProtocolSemanticInvocationFailureCategory,
    code: string,
    message: string,
    options: {
      readonly path?: string;
      readonly cause?: unknown;
      readonly retryable?: boolean;
      readonly relist?: boolean;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DeploymentSemanticInvocationError';
    this.category = category;
    this.code = code;
    this.path = options.path;
    this.retryable = options.retryable ?? false;
    this.relist = options.relist ?? false;
  }
}

export function fail(
  category: ProtocolSemanticInvocationFailureCategory,
  code: string,
  message: string,
  options: {
    readonly path?: string;
    readonly cause?: unknown;
    readonly retryable?: boolean;
    readonly relist?: boolean;
  } = {},
): never {
  throw new DeploymentSemanticInvocationError(category, code, message, options);
}

/**
 * Projects a failure onto the portable record.
 *
 * The message is deliberately the one this module produced. A cause is never
 * unwrapped into it, so a provider exception cannot reach a caller.
 */
export function toProtocolSemanticInvocationFailure(
  error: unknown,
  activationRevision?: string,
): ProtocolSemanticInvocationFailure {
  const known = error instanceof DeploymentSemanticInvocationError;
  return Object.freeze({
    kind: 'hypequery-semantic-invocation-failure',
    version: 1,
    category: known ? error.category : 'executor-failed',
    code: known ? error.code : 'HQ_SEMANTIC_EXECUTION_FAILED',
    message: known ? error.message : 'Semantic invocation failed.',
    ...(known && error.path !== undefined ? { path: error.path } : {}),
    retryable: known ? error.retryable : false,
    relist: known ? error.relist : false,
    ...(activationRevision === undefined ? {} : { activationRevision }),
  }) as ProtocolSemanticInvocationFailure;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    fail('cancelled', 'HQ_SEMANTIC_CANCELLED', 'The invocation was cancelled.');
  }
}

