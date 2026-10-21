import type { AnyDatasetInstance, DatasetQuery } from '@hypequery/datasets';
import { queryFieldReferences } from '@hypequery/datasets/internal';
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
 * Policies of the served dataset entries, by dataset object: a relationship
 * reads one specific definition, and two definitions may share a name. A
 * dataset served by several entries is readable through a relationship when
 * any one admits the caller.
 */
export interface RelatedDatasetPolicies {
  readonly byDataset: ReadonlyMap<AnyDatasetInstance, readonly DatasetAccessPolicy[]>;
  readonly byName: ReadonlyMap<string, readonly DatasetAccessPolicy[]>;
}

/**
 * *globalAuth* says whether the API has global auth strategies; an entry with
 * no local requirement inherits them, as its own endpoint does.
 */
export function collectRelatedDatasetPolicies(
  entries: Readonly<Record<string, DatasetEntry<any>>>,
  globalAuth = false,
): RelatedDatasetPolicies {
  const byDataset = new Map<AnyDatasetInstance, DatasetAccessPolicy[]>();
  const byName = new Map<string, DatasetAccessPolicy[]>();
  for (const entry of Object.values(entries)) {
    const resolved = resolveDatasetEntry(entry);
    const policy: DatasetAccessPolicy = {
      requiresAuth: resolveLocalAuthRequirement(resolved) ?? globalAuth,
      requiredRoles: resolved.requiredRoles ?? [],
      requiredScopes: resolved.requiredScopes ?? [],
    };
    byDataset.set(resolved.dataset, [...(byDataset.get(resolved.dataset) ?? []), policy]);
    byName.set(resolved.dataset.name, [...(byName.get(resolved.dataset.name) ?? []), policy]);
  }
  return { byDataset, byName };
}

function admits(policy: DatasetAccessPolicy, auth: AuthContext | null): boolean {
  if (policy.requiresAuth && !auth) return false;
  if (policy.requiredRoles.length > 0 && !checkRoleAuthorization(auth, [...policy.requiredRoles]).ok) return false;
  if (policy.requiredScopes.length > 0 && !checkScopeAuthorization(auth, [...policy.requiredScopes]).ok) return false;
  return true;
}

/** Relationship names a query reads through, including through measure filters and defaults. */
function referencedRelationships(dataset: AnyDatasetInstance, query: DatasetQuery): Set<string> {
  const relationships = new Set<string>();
  for (const name of queryFieldReferences(dataset, query)) {
    if (typeof name !== 'string' || !name.includes('.')) continue;
    const relation = name.slice(0, name.indexOf('.'));
    if (Object.prototype.hasOwnProperty.call(dataset.relationships ?? {}, relation)) relationships.add(relation);
  }
  return relationships;
}

/** Whether *auth* may read *target* through a relationship. */
function admitsRelated(target: AnyDatasetInstance, auth: AuthContext | null, policies: RelatedDatasetPolicies): boolean {
  const served = policies.byDataset.get(target);
  if (served) return served.some(policy => admits(policy, auth));
  // Not served itself, but another definition with its name is: hold the
  // caller to every such entry rather than guess which one it stands for.
  const namesake = policies.byName.get(target.name);
  return !namesake || namesake.every(policy => admits(policy, auth));
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
  if (!policies || policies.byName.size === 0) return;
  for (const relation of referencedRelationships(dataset, query)) {
    const target = dataset.relationships[relation]!.target() as AnyDatasetInstance;
    if (!admitsRelated(target, auth, policies)) {
      throw new ServeHttpError(
        403,
        'FORBIDDEN',
        `Access denied to fields of related dataset "${relation}".`,
      );
    }
  }
}
