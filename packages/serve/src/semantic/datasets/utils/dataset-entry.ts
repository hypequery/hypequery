import type {
  AuthContext,
  AuthStrategy,
  TenantConfigOverride,
} from '../../../types.js';
import type { DatasetInstance } from '@hypequery/datasets';

export type DatasetEntry<TAuth extends AuthContext = AuthContext> =
  | DatasetInstance
  | {
      dataset: DatasetInstance;
      auth?: AuthStrategy<TAuth> | null;
      tenant?: TenantConfigOverride<TAuth>;
      cache?: number | null;
      requiredRoles?: string[];
      requiredScopes?: string[];
      maxLimit?: number;
    };

type DatasetEntryOptions<TAuth extends AuthContext> = Exclude<DatasetEntry<TAuth>, DatasetInstance>;

function isDatasetInstance<TAuth extends AuthContext>(
  entry: DatasetEntry<TAuth>,
): entry is DatasetInstance {
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
  dataset: DatasetInstance;
  auth?: AuthStrategy<TAuth> | null;
  tenant?: TenantConfigOverride<TAuth>;
  cache?: number | null;
  requiredRoles?: string[];
  requiredScopes?: string[];
  maxLimit?: number;
} {
  if (isDatasetInstance(entry)) {
    return { dataset: entry };
  }

  if (isDatasetEntryOptions(entry)) {
    return entry;
  }

  throw new Error('Invalid dataset entry.');
}
