import type {
  AuthContext,
  AuthStrategy,
  ServeMiddleware,
  TenantConfigOverride,
} from '../../../types.js';
import type { AnyDatasetInstance } from '@hypequery/datasets';

export type DatasetEntry<TAuth extends AuthContext = AuthContext> =
  | AnyDatasetInstance
  | {
      dataset: AnyDatasetInstance;
      /** Local auth strategy. `null` omits it while still inheriting global auth. */
      auth?: AuthStrategy<TAuth> | null;
      /** Set to `false` for public access. Required roles or scopes take precedence. */
      requiresAuth?: boolean;
      tenant?: TenantConfigOverride<TAuth>;
      cache?: number | null;
      requiredRoles?: string[];
      requiredScopes?: string[];
      /** Middleware applied to this dataset endpoint. */
      middlewares?: ServeMiddleware<any, any, any, TAuth>[];
      maxLimit?: number;
      /** Enable SQL and internal tenant IDs in opt-in metadata only on trusted endpoints. */
      trustedDiagnostics?: boolean;
      /**
       * Lets this endpoint stream its result, for exports and other large reads.
       * A request asks with `Accept: application/x-ndjson` (row batches as NDJSON
       * frames) or `Accept: application/vnd.apache.arrow.stream` (an Arrow IPC
       * stream); without this option those requests get a JSON page. `maxRows`
       * caps one streamed response and defaults to `maxLimit`; it may not exceed
       * the dataset's `limits.maxResultSize`.
       */
      stream?: boolean | { maxRows?: number };
    };

type DatasetEntryOptions<TAuth extends AuthContext> = Exclude<DatasetEntry<TAuth>, AnyDatasetInstance>;

function isDatasetInstance<TAuth extends AuthContext>(
  entry: DatasetEntry<TAuth>,
): entry is AnyDatasetInstance {
  return !!entry && typeof entry === 'object' && '__type' in entry && entry.__type === 'dataset';
}

function isDatasetEntryOptions<TAuth extends AuthContext>(
  entry: DatasetEntry<TAuth>,
): entry is DatasetEntryOptions<TAuth> {
  return !!entry && typeof entry === 'object' && 'dataset' in entry;
}

export function resolveDatasetEntry<TAuth extends AuthContext>(
  entry: DatasetEntry<TAuth>,
): {
  dataset: AnyDatasetInstance;
  auth?: AuthStrategy<TAuth> | null;
  requiresAuth?: boolean;
  tenant?: TenantConfigOverride<TAuth>;
  cache?: number | null;
  requiredRoles?: string[];
  requiredScopes?: string[];
  middlewares?: ServeMiddleware<any, any, any, TAuth>[];
  maxLimit?: number;
  /** Enable SQL and internal tenant IDs in opt-in metadata only on trusted endpoints. */
  trustedDiagnostics?: boolean;
  stream?: boolean | { maxRows?: number };
} {
  if (isDatasetInstance(entry)) {
    return { dataset: entry };
  }

  if (isDatasetEntryOptions(entry)) {
    return entry;
  }

  throw new Error('Invalid dataset entry.');
}

/**
 * The row cap of a streaming endpoint, or `undefined` when it does not stream.
 * A cap above the dataset's own ceiling is refused here rather than failing
 * every request's validation.
 */
export function resolveStreamMaxRows(
  name: string,
  dataset: AnyDatasetInstance,
  stream: boolean | { maxRows?: number } | undefined,
  pageCap: number,
): number | undefined {
  if (!stream) return undefined;
  const maxRows = stream === true ? pageCap : stream.maxRows ?? pageCap;
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new Error(`Dataset endpoint "${name}": stream.maxRows must be a positive integer.`);
  }
  const ceiling = dataset.limits?.maxResultSize;
  if (ceiling !== undefined && maxRows > ceiling) {
    throw new Error(
      `Dataset endpoint "${name}": stream.maxRows (${maxRows}) exceeds the dataset's limits.maxResultSize (${ceiling}).`,
    );
  }
  return maxRows;
}
