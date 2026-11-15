import {
  validateProtocolBusinessContext,
  type ProtocolBusinessContext,
  type ProtocolDeploymentContract,
} from '@hypequery/protocol';

/** Business context as authored in code: the document without its header. */
export type BusinessContextInput = Omit<ProtocolBusinessContext, 'kind' | 'version'>;

/**
 * Everything `hypequery deploy` publishes to Cloud from a code project.
 *
 * The deployment contract stays the executable source of truth; the business
 * context travels beside it in the same immutable release, so publishing,
 * staging and rollback move both together.
 */
export interface CloudPublication {
  readonly kind: 'hypequery-cloud-publication';
  readonly version: 1;
  readonly deployment: ProtocolDeploymentContract;
  readonly businessContext?: ProtocolBusinessContext;
}

export interface CloudPublicationOptions {
  /** The result of `publishToCloud({ datasets, access })`. */
  readonly deployment: ProtocolDeploymentContract;
  /** Reviewed business context: summary, KPIs, glossary, conventions, caveats. */
  readonly businessContext?: ProtocolBusinessContext | BusinessContextInput;
}

/**
 * Declare reviewed business context for AI analysts in Cloud.
 *
 * Text is trimmed and empty lists are dropped. Throws a
 * `ProtocolBusinessContextError` naming the offending path when the document
 * is invalid, e.g. a glossary term defined twice.
 */
export function defineBusinessContext(input: BusinessContextInput): ProtocolBusinessContext {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('defineBusinessContext expects an object.');
  }
  return validateProtocolBusinessContext({
    ...input,
    kind: 'hypequery-business-context',
    version: 1,
  });
}

function isBusinessContextDocument(value: object): value is ProtocolBusinessContext {
  return 'kind' in value && (value as { kind?: unknown }).kind === 'hypequery-business-context';
}

/**
 * Bundle a deployment contract with its business context for Cloud.
 * Export the result as `cloud` from the deployment entrypoint. A bare
 * `publishToCloud(...)` export remains valid and publishes no context.
 */
export function defineCloudPublication(options: CloudPublicationOptions): CloudPublication {
  const deployment = options?.deployment as unknown;
  if (typeof deployment !== 'object' || deployment === null
    || (deployment as { kind?: unknown }).kind !== 'hypequery-deployment') {
    throw new Error(
      'defineCloudPublication requires `deployment: publishToCloud({ datasets, access })`.',
    );
  }
  const input = options.businessContext;
  let businessContext: ProtocolBusinessContext | undefined;
  if (input !== undefined) {
    businessContext = isBusinessContextDocument(input)
      ? validateProtocolBusinessContext(input)
      : defineBusinessContext(input);
  }
  return Object.freeze({
    kind: 'hypequery-cloud-publication',
    version: 1,
    deployment: options.deployment,
    ...(businessContext ? { businessContext } : {}),
  });
}
