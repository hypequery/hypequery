import type { ProtocolDeploymentDataset, ProtocolEndpointPolicy } from '@hypequery/protocol';

import { stableStringify, uniqueSorted } from '../utils/canonical-json.js';
import { code, literal } from './utils/source-writer.js';

/**
 * The `cloud.ts` entrypoint: `publishToCloud` with the options that rebuild
 * every endpoint exactly.
 *
 * Most endpoints are what `publishToCloud` derives from one access policy, so
 * the most common policy becomes `access`, others become `datasetAccess`, and
 * only an endpoint no access policy derives (an optional tenant, a cache TTL,
 * no row limit) is written out in `endpoints`. Datasets without an endpoint
 * that no published dataset reaches through a relationship go in `supporting`.
 */

interface Access {
  readonly roles: readonly string[];
  readonly scopes: readonly string[];
}

/** What `publishToCloud` derives for `dataset` under `access`. */
function derivedEndpoint(dataset: ProtocolDeploymentDataset, access: Access): ProtocolEndpointPolicy {
  return {
    access: { kind: 'authenticated', roles: uniqueSorted(access.roles), scopes: uniqueSorted(access.scopes) },
    tenant: dataset.tenant.kind === 'required'
      ? { kind: 'required', mode: 'auto-inject', column: dataset.tenant.field }
      : { kind: 'not-required' },
    maxLimit: dataset.limits?.maxResultSize ?? 1_000,
    path: `/api/analytics/datasets/${String(dataset.name)}/query`,
  };
}

/** The access policy that derives this endpoint exactly, if there is one. */
function derivingAccess(dataset: ProtocolDeploymentDataset): Access | undefined {
  const endpoint = dataset.endpoint;
  if (endpoint === undefined || endpoint.access.kind !== 'authenticated') return undefined;
  const access = { roles: [...endpoint.access.roles], scopes: [...endpoint.access.scopes] };
  return stableStringify(derivedEndpoint(dataset, access)) === stableStringify(endpoint) ? access : undefined;
}

/** Names reachable from `start` through relationships, `start` included. */
function reachable(
  start: readonly string[],
  byName: ReadonlyMap<string, ProtocolDeploymentDataset>,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const relationship of byName.get(name)?.relationships ?? []) queue.push(String(relationship.target));
  }
  return seen;
}

export interface CloudSource {
  readonly code: string;
  /** Dataset constants `cloud.ts` imports from `datasets.ts`, besides `datasets`. */
  readonly supporting: readonly string[];
}

export function cloudSource(
  datasets: readonly ProtocolDeploymentDataset[],
  constants: ReadonlyMap<string, string>,
  importSource: string,
): CloudSource {
  const exposed = datasets.filter(dataset => dataset.endpoint !== undefined);
  const byName = new Map(datasets.map(dataset => [String(dataset.name), dataset]));
  const reached = reachable(exposed.map(dataset => String(dataset.name)), byName);

  const accessByDataset = new Map(exposed.map(dataset => [String(dataset.name), derivingAccess(dataset)]));
  const counts = new Map<string, { access: Access; count: number }>();
  for (const access of accessByDataset.values()) {
    if (access === undefined) continue;
    const key = stableStringify(access);
    const entry = counts.get(key) ?? { access, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  // The most common policy; ties go to the first in sorted key order, so the
  // choice doesn't depend on dataset order.
  const defaultAccess = [...counts.entries()]
    .sort(([leftKey, left], [rightKey, right]) => right.count - left.count || (leftKey < rightKey ? -1 : 1))[0]?.[1].access
    ?? { roles: [], scopes: [] };
  const defaultKey = stableStringify(defaultAccess);

  const datasetAccess: Record<string, Access> = {};
  const endpoints: Record<string, ProtocolEndpointPolicy> = {};
  for (const dataset of exposed) {
    const name = String(dataset.name);
    const access = accessByDataset.get(name);
    if (access === undefined) endpoints[name] = dataset.endpoint as ProtocolEndpointPolicy;
    else if (stableStringify(access) !== defaultKey) datasetAccess[name] = access;
  }
  const supporting = datasets
    .filter(dataset => dataset.endpoint === undefined && !reached.has(String(dataset.name)))
    .map(dataset => String(dataset.name));

  const options = {
    datasets: code('datasets'),
    access: { roles: [...defaultAccess.roles], scopes: [...defaultAccess.scopes] },
    datasetAccess: Object.keys(datasetAccess).length > 0 ? datasetAccess : undefined,
    endpoints: Object.keys(endpoints).length > 0 ? endpoints : undefined,
    supporting: supporting.length > 0
      ? Object.fromEntries(supporting.map(name => [name, code(constants.get(name) as string)]))
      : undefined,
  };
  const supportingConstants = supporting.map(name => constants.get(name) as string);
  const fromDatasets = ['datasets', ...supportingConstants].join(', ');
  return {
    code: [
      `import { publishToCloud } from ${literal(importSource)};`,
      `import { ${fromDatasets} } from './datasets.js';`,
      '',
      `export const cloud = publishToCloud(${literal(options)});`,
      '',
    ].join('\n'),
    supporting: supportingConstants,
  };
}
