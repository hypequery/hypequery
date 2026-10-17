/**
 * What one principal is allowed to see of a deployment contract.
 *
 * Discovery and execution must agree about who may reach what. The data plane
 * already decides that per call, from the endpoint policy on the target; a
 * gateway listing tools has to make the same decision over the whole contract,
 * before any call exists. Restating the rule there would put an authorization
 * predicate in two packages, and the copy that drifts is the one that leaks.
 *
 * The projection narrows, never widens: it can remove a target a principal may
 * not reach, and can never add one or loosen a policy. Feeding the result to
 * catalog projection or schema compilation therefore cannot advertise something
 * execution would refuse.
 */

import type {
  ProtocolAccessPolicy,
  ProtocolDeploymentContract,
  ProtocolDeploymentDataset,
  ProtocolEndpointPolicy,
  ProtocolFieldVisibility,
  ProtocolVisibleDatasetFields,
} from '@hypequery/protocol';
import {
  resolveProtocolVisibleDatasetFields,
  validateProtocolDeploymentContract,
} from '@hypequery/protocol';
import type { DeploymentDataPlanePrincipal } from './principal.js';
import { missing } from './utils/required-access.js';

/**
 * Whether a principal satisfies an access policy.
 *
 * Shares `missing` with the semantic data plane rather than restating it, which
 * is the whole point of this module existing in Core: one predicate, so
 * discovery cannot come to answer differently than execution.
 */
export function satisfiesDeploymentAccess(
  access: ProtocolAccessPolicy,
  principal: DeploymentDataPlanePrincipal | null,
): boolean {
  if (access.kind === 'public') return true;
  if (!principal) return false;
  return !missing(access.roles, principal.roles) && !missing(access.scopes, principal.scopes);
}

/** Whether a principal may reach a target published under this endpoint policy. */
export function isDeploymentEndpointAuthorized(
  endpoint: ProtocolEndpointPolicy | undefined,
  principal: DeploymentDataPlanePrincipal | null,
): boolean {
  // An absent endpoint is not a permissive one. A contract may describe a
  // dataset it never published, and an unpublished target is unreachable for
  // everyone — which is how the data plane's own target resolution reads it.
  return endpoint !== undefined && satisfiesDeploymentAccess(endpoint.access, principal);
}

/**
 * Narrows a dataset retained only to support a join.
 *
 * The principal cannot address this dataset, so advertising it whole would
 * publish the name and type of every dimension, filter, and measure on it.
 * What a join actually reaches is the target's dimensions — `resolveDataset`
 * offers each groupable one as `<relationship>.<name>` and each filterable one
 * under the full operator set — so those stay and everything else goes.
 *
 * A dataset no queryable relationship reaches keeps nothing but its time field,
 * which the planner reads for every grained query. It is retained at all only
 * because a relationship names it and the contract would not validate without
 * it.
 */
/**
 * Narrows a dimension to one the principal can neither group nor filter by.
 *
 * Measures, relationships and the tenant key may still reference it, so it
 * stays in the contract; the safe catalog omits a dimension that is neither,
 * so it is not advertised.
 */
function concealDimension<T extends { readonly groupable: boolean; readonly filterable: boolean }>(
  dimension: T,
): T {
  return { ...dimension, groupable: false, filterable: false };
}

/**
 * Narrows a published dataset to what a visibility policy shows (RFC 0018),
 * using the same resolution the data plane enforces, so discovery never
 * advertises a field execution would refuse.
 */
function narrowToVisible(
  dataset: ProtocolDeploymentDataset,
  visible: ProtocolVisibleDatasetFields,
): ProtocolDeploymentDataset {
  const { defaults, timeField, ...rest } = dataset;
  const visibleDefaults = defaults === undefined ? undefined : {
    ...(defaults.dimensions === undefined ? {} : {
      dimensions: defaults.dimensions.filter(name => visible.dimensions.has(String(name))),
    }),
    ...(defaults.timeGrain === undefined || !visible.timeField ? {} : { timeGrain: defaults.timeGrain }),
  };
  return {
    ...rest,
    ...(visible.timeField && timeField !== undefined ? { timeField } : {}),
    ...(visibleDefaults === undefined ? {} : { defaults: visibleDefaults }),
    dimensions: dataset.dimensions.map(dimension => (
      visible.dimensions.has(String(dimension.name)) ? dimension : concealDimension(dimension)
    )),
    measures: dataset.measures.filter(measure => visible.measures.has(String(measure.name))),
    filters: dataset.filters.filter(filter => visible.filters.has(String(filter.name))),
  } as ProtocolDeploymentDataset;
}

function narrowToJoin(
  dataset: ProtocolDeploymentDataset,
  reachable: boolean,
  visibleDimensions?: ReadonlySet<string>,
): ProtocolDeploymentDataset {
  // `defaults` describes how to query the dataset directly, which is exactly
  // what this principal may not do.
  const { defaults: _defaults, endpoint: _endpoint, ...rest } = dataset;
  const timeField = dataset.timeField === undefined ? undefined : String(dataset.timeField);
  return {
    ...rest,
    dimensions: reachable
      ? dataset.dimensions.map(dimension => (
          visibleDimensions === undefined || visibleDimensions.has(String(dimension.name))
            ? dimension
            : concealDimension(dimension)
        ))
      : dataset.dimensions.filter(dimension => String(dimension.name) === timeField),
    measures: [],
    filters: [],
  } as ProtocolDeploymentDataset;
}

export interface AuthorizedDeploymentProjection {
  /**
   * A valid contract narrowed to what the principal may see, including any
   * dataset retained only to support a join.
   */
  readonly contract: ProtocolDeploymentContract;
  /**
   * Datasets addressable as a `query_dataset` target, in contract order.
   *
   * Narrower than `contract.datasets`, which also holds datasets retained only
   * to support a join. Always read this before advertising anything: catalog
   * projection and rehydration enumerate every dataset they are given and
   * neither consults an endpoint, so handing them the whole contract would
   * advertise a supporting dataset and disclose its shape to a principal with
   * no access to it.
   */
  readonly queryable: readonly string[];
}

/**
 * Projects the contract down to what `principal` may see.
 *
 * A dataset is *published* when the principal may address it directly, and
 * *supporting* when something published still needs it to stay coherent — the
 * target of a relationship. A supporting dataset loses its endpoint and keeps
 * only what a join reaches, so a relationship can still be traversed exactly as
 * execution would traverse it while the dataset itself is not offered as a
 * target.
 *
 * Dropping a relationship target instead would be the tempting alternative and
 * is wrong twice: it would invalidate the relationship that names it, and it
 * would advertise less than the data plane permits, since a one-hop join is
 * governed by the endpoint of the dataset being queried, not by the target's.
 *
 * The contract and the target list are returned separately rather than as one
 * contract because nothing downstream reads an endpoint.
 * `projectAgentSafeCatalog` and `rehydrateProtocolDatasets` enumerate whatever
 * they are handed, so an unpublished dataset left in the contract they see is
 * an advertised one.
 *
 * The contract is revalidated. Callers hand it to catalog projection, schema
 * compilation, and rehydration, all of which assume a valid contract; a
 * projection that could emit an invalid one would move that failure to whatever
 * read it next.
 */
export interface AuthorizedDeploymentProjectionOptions {
  /**
   * A validated field-visibility policy for this principal (RFC 0018). A
   * dataset it hides is not published; fields it hides are not advertised.
   */
  readonly visibility?: ProtocolFieldVisibility;
}

export function projectAuthorizedDeploymentContract(
  contract: ProtocolDeploymentContract,
  principal: DeploymentDataPlanePrincipal | null,
  options: AuthorizedDeploymentProjectionOptions = {},
): AuthorizedDeploymentProjection {
  const byName = new Map(contract.datasets.map(dataset => [String(dataset.name), dataset]));
  const visibleFields = new Map<string, ProtocolVisibleDatasetFields | null>();
  const visibleIn = (dataset: ProtocolDeploymentDataset) => {
    if (options.visibility === undefined) return undefined;
    const name = String(dataset.name);
    if (!visibleFields.has(name)) {
      visibleFields.set(name, resolveProtocolVisibleDatasetFields(dataset, byName, options.visibility));
    }
    return visibleFields.get(name);
  };
  const published = new Set(contract.datasets
    .filter(dataset => isDeploymentEndpointAuthorized(dataset.endpoint, principal))
    .filter(dataset => visibleIn(dataset) !== null)
    .map(dataset => String(dataset.name)));

  const required = new Set<string>();
  const require = (name: string) => {
    if (required.has(name) || !byName.has(name)) return;
    required.add(name);
    // Transitive: a retained target has relationships of its own, and every
    // target named in the contract has to still be there for it to validate.
    for (const relationship of byName.get(name)!.relationships) {
      require(String(relationship.target));
    }
  };
  for (const name of published) require(name);

  // What each dataset is reachable *as a join target* for. Reach extends one
  // queryable hop — `resolveDataset` does not recurse — and only from a dataset
  // the principal can address, so a dataset retained purely so the contract
  // validates passes none of it on.
  const reachable = new Set<string>();
  for (const name of published) {
    for (const relationship of byName.get(name)!.relationships) {
      if (relationship.queryable) reachable.add(String(relationship.target));
    }
  }

  // What a join may reach on a target: its own policy entry, if any. Without
  // one, a hidden target contributes no joined fields.
  const joinable = (dataset: ProtocolDeploymentDataset) => {
    if (options.visibility === undefined) return undefined;
    const entry = Object.hasOwn(options.visibility.datasets, String(dataset.name))
      ? options.visibility.datasets[String(dataset.name)]
      : undefined;
    if (entry === undefined) return new Set<string>();
    return entry.dimensions === '*'
      ? new Set(dataset.dimensions.map(dimension => String(dimension.name)))
      : new Set(entry.dimensions);
  };

  const datasets = contract.datasets
    .filter(dataset => required.has(String(dataset.name)))
    .map(dataset => {
      if (!published.has(String(dataset.name))) {
        return narrowToJoin(dataset, reachable.has(String(dataset.name)), joinable(dataset));
      }
      const visible = visibleIn(dataset);
      return visible ? narrowToVisible(dataset, visible) : dataset;
    });

  return Object.freeze({
    contract: validateProtocolDeploymentContract({ ...contract, datasets }),
    queryable: Object.freeze(datasets
      .filter(dataset => published.has(String(dataset.name)))
      .map(dataset => String(dataset.name))),
  });
}
