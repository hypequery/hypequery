import type { AnyDatasetInstance, DatasetQuery } from '@hypequery/datasets';
import { checkRoleAuthorization, checkScopeAuthorization } from '../../../auth.js';
import { resolveLocalAuthRequirement } from '../../../auth-requirement.js';
import { ServeHttpError } from '../../../errors.js';
import type { AuthContext } from '../../../types.js';
import { resolveDatasetEntry, type DatasetEntry } from './dataset-entry.js';

/** The access rules of one dataset entry, as its own endpoint enforces them. */
interface DatasetAccessPolicy {
  requiresAuth: boolean;
  requiredRoles: readonly string[];
  requiredScopes: readonly string[];
}

/**
 * Policies of the served dataset entries, by dataset name. A dataset served by
 * several entries is readable through a relationship when any one admits the caller.
 */
export type RelatedDatasetPolicies = ReadonlyMap<string, readonly DatasetAccessPolicy[]>;

export function collectRelatedDatasetPolicies(
  entries: Readonly<Record<string, DatasetEntry<any>>>,
): RelatedDatasetPolicies {
  const policies = new Map<string, DatasetAccessPolicy[]>();
  for (const entry of Object.values(entries)) {
    const resolved = resolveDatasetEntry(entry);
    const list = policies.get(resolved.dataset.name) ?? [];
    list.push({
      requiresAuth: resolveLocalAuthRequirement(resolved) === true,
      requiredRoles: resolved.requiredRoles ?? [],
      requiredScopes: resolved.requiredScopes ?? [],
    });
    policies.set(resolved.dataset.name, list);
  }
  return policies;
}

function admits(policy: DatasetAccessPolicy, auth: AuthContext | null): boolean {
  if (policy.requiresAuth && !auth) return false;
  if (policy.requiredRoles.length > 0 && !checkRoleAuthorization(auth, [...policy.requiredRoles]).ok) return false;
  if (policy.requiredScopes.length > 0 && !checkScopeAuthorization(auth, [...policy.requiredScopes]).ok) return false;
  return true;
}

/** Relationship names a query reads through, including named filters defined on a related field. */
function referencedRelationships(dataset: AnyDatasetInstance, query: DatasetQuery): Set<string> {
  const names: string[] = [
    ...(query.dimensions ?? []),
    ...(query.measures ?? []),
    ...(query.filters ?? []).map(filter => dataset.filters?.[filter.field]?.field ?? filter.field),
    ...(query.orderBy ?? []).map(order => order.field),
    ...(query.having ?? []).map(condition => condition.measure),
  ];
  const relationships = new Set<string>();
  for (const name of names) {
    if (typeof name !== 'string' || !name.includes('.')) continue;
    const relation = name.slice(0, name.indexOf('.'));
    if (Object.prototype.hasOwnProperty.call(dataset.relationships ?? {}, relation)) relationships.add(relation);
  }
  return relationships;
}

/**
 * An endpoint's roles and scopes gate that endpoint, not the datasets its
 * relationships reach. When a query reads a related dataset that is itself
 * served, the caller must also satisfy that dataset's own endpoint policy;
 * related datasets that are not served stay readable through the relationship.
 */
export function assertRelatedDatasetAccess(
  dataset: AnyDatasetInstance,
  query: DatasetQuery,
  auth: AuthContext | null,
  policies: RelatedDatasetPolicies | undefined,
): void {
  if (!policies || policies.size === 0) return;
  for (const relation of referencedRelationships(dataset, query)) {
    const target = dataset.relationships[relation]!.target();
    const served = policies.get(target.name);
    if (served && !served.some(policy => admits(policy, auth))) {
      throw new ServeHttpError(
        403,
        'FORBIDDEN',
        `Access denied to fields of related dataset "${relation}".`,
      );
    }
  }
}
