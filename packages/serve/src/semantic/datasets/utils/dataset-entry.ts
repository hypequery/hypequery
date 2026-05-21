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
  if (entry && typeof entry === 'object' && '__type' in entry && entry.__type === 'dataset') {
    return { dataset: entry as DatasetInstance };
  }

  return entry as {
    dataset: DatasetInstance;
    auth?: AuthStrategy<TAuth> | null;
    tenant?: TenantConfigOverride<TAuth>;
    cache?: number | null;
    requiredRoles?: string[];
    requiredScopes?: string[];
    maxLimit?: number;
  };
}
