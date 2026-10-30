import {
  prepareProtocolClientContract,
  type PreparedProtocolClientContract,
  type ProtocolDeploymentContract,
  type ProtocolDeploymentDataset,
} from '@hypequery/protocol';
import { PORTABLE_TIME_GRAINS } from '../utils/portable-grains.js';
import { endpointAnnotations } from './deployment-annotations.js';
import { publicFields } from './deployment-fields.js';
import { clientQueryLimits, resolveClientContractProfile, type ClientContractProfile } from './deployment-profile.js';

export interface BuildClientContractOptions {
  /** Ceilings the host enforces; defaults mirror Python's ClientQueryProfile. */
  readonly profile?: ClientContractProfile;
  /**
   * Trusted mount prefix, such as `/v1`: absolute, no trailing slash. Never a
   * proxy or request header; the host knows how it is mounted.
   */
  readonly mountPath?: string;
  /** Final route per published dataset, when the host serves it somewhere other than `endpoint.path`. */
  readonly paths?: Readonly<Record<string, string>>;
  /** `authorized` is a caller's view, narrowed by `include`. */
  readonly view?: 'build' | 'authorized';
  /** Which published datasets to advertise; every one by default. */
  readonly include?: (dataset: ProtocolDeploymentDataset) => boolean;
}

function endpointPath(dataset: ProtocolDeploymentDataset, options: BuildClientContractOptions): string {
  const path = options.paths?.[dataset.name] ?? dataset.endpoint?.path;
  if (path === undefined || !path.startsWith('/')) {
    throw new Error(`Client export: dataset "${dataset.name}" needs an absolute endpoint path.`);
  }
  return (options.mountPath ?? '') + path;
}

function endpointDescriptor(
  dataset: ProtocolDeploymentDataset,
  options: BuildClientContractOptions,
  profile: ReturnType<typeof resolveClientContractProfile>,
): Record<string, unknown> {
  const { dimensions, measures, filters } = publicFields(dataset);
  // Rows carry the time bucket as `period`, so a field of that name would collide.
  if (dataset.timeField !== undefined && (Object.hasOwn(dimensions, 'period') || Object.hasOwn(measures, 'period'))) {
    throw new Error(`Client export: dataset "${dataset.name}" has a field named "period", which its time bucket uses. Rename it.`);
  }
  const limits = clientQueryLimits(dataset, profile);
  const annotations = endpointAnnotations(dataset, Object.keys(dimensions), Object.keys(measures));
  return {
    id: dataset.name,
    kind: 'dataset',
    dataset: dataset.name,
    path: endpointPath(dataset, options),
    dimensions,
    measures,
    filters,
    metadata: true,
    limits,
    // Deployment contract 2 carries day-and-longer grains only.
    time: dataset.timeField === undefined ? null : {
      grains: [...PORTABLE_TIME_GRAINS],
      defaultTimezone: profile.defaultTimezone,
      timezone: true,
      periodFormat: 'calendar-date-or-local-datetime-v1',
    },
    // An endpoint's default selection is the base measures it can serve.
    // Capped at the measure budget, so a dataset with more base measures than
    // it may select at once still exports instead of failing the contract.
    defaultMeasures: dataset.measures
      .filter(measure => !('kind' in measure) && Object.hasOwn(measures, measure.name))
      .map(measure => measure.name)
      .slice(0, limits.maxMeasures),
    ...(annotations ? { annotations } : {}),
  };
}

/**
 * The client contract for a deployment's published datasets: typed fields,
 * routes and schema hashes `hypequery generate:client` turns into React types
 * and a route manifest. Pure: no network, no execution. Datasets without an
 * endpoint policy (relationship targets) are not advertised, and neither are
 * relationship fields yet.
 */
export function buildClientContract(
  contract: ProtocolDeploymentContract,
  options: BuildClientContractOptions = {},
): PreparedProtocolClientContract {
  const { mountPath } = options;
  if (mountPath && (!mountPath.startsWith('/') || mountPath.endsWith('/'))) {
    throw new Error('Client export: mountPath must be empty or an absolute path without a trailing slash.');
  }
  const profile = resolveClientContractProfile(options.profile);
  const published = contract.datasets
    .filter(dataset => dataset.endpoint !== undefined && (options.include?.(dataset) ?? true));
  return prepareProtocolClientContract({
    kind: 'hypequery-client-contract',
    version: 1,
    view: options.view ?? 'build',
    endpoints: published.map(dataset => endpointDescriptor(dataset, options, profile)),
  });
}
