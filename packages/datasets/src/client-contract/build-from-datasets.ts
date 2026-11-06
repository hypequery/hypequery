import {
  prepareProtocolClientContract,
  type PreparedProtocolClientContract,
} from '@hypequery/protocol';
import { SUPPORTED_TIME_GRAINS } from '../constants.js';
import type { AnyDatasetInstance, MetricRef } from '../types.js';
import { baseMeasureNames } from '../utils/dataset-measures.js';
import { datasetEndpointAnnotations } from './dataset-annotations.js';
import { datasetPublicFields } from './dataset-fields.js';
import { narrowClientQueryLimits, resolveClientContractProfile, type ClientContractProfile } from './deployment-profile.js';

/** One logical endpoint a host serves: a dataset query, or one metric of a dataset. */
export interface DatasetClientEndpoint {
  /** The dataset queried, or the dataset the metric reads. */
  readonly dataset: AnyDatasetInstance;
  /** The absolute route the host serves this endpoint at, below `mountPath`. */
  readonly path: string;
  /** For a metric endpoint, the metric it serves. Its rows carry the value under the metric's name. */
  readonly metric?: MetricRef;
  /** A metric endpoint's export ID, such as its route key; the metric's name by default. */
  readonly name?: string;
  /**
   * Ceilings the host enforces for this endpoint; defaults mirror Python's
   * ClientQueryProfile. The export only ever narrows them by the dataset's limits.
   */
  readonly profile?: ClientContractProfile;
}

export interface BuildDatasetClientContractOptions {
  /**
   * Trusted mount prefix, such as `/v1`: absolute, no trailing slash. Never a
   * proxy or request header; the host knows how it is mounted.
   */
  readonly mountPath?: string;
  /** `authorized` is a caller's view: the host passes only that caller's endpoints. */
  readonly view?: 'build' | 'authorized';
}

function endpointDescriptor(endpoint: DatasetClientEndpoint, mountPath: string): Record<string, unknown> {
  const { dataset, metric } = endpoint;
  if (!endpoint.path.startsWith('/')) {
    throw new Error(`Client export: the endpoint for "${dataset.name}" needs an absolute path.`);
  }
  if (metric !== undefined && metric.dataset !== dataset) {
    throw new Error(`Client export: metric "${metric.name}" does not read dataset "${dataset.name}".`);
  }
  const fields = datasetPublicFields(dataset);
  const { dimensions, filters } = fields;
  const id = metric === undefined ? dataset.name : endpoint.name ?? metric.name;
  if (metric !== undefined && id === dataset.name) {
    throw new Error(`Client export: metric "${id}" needs an export ID other than its dataset's name.`);
  }
  // A metric's rows carry its one value under the metric's name.
  const measures = metric === undefined
    ? fields.measures
    : { [metric.name]: { wireType: 'string' as const, nullable: true as const, having: false } };
  // Rows carry the time bucket as `period`, so a field of that name would collide.
  if (dataset.timeKey !== undefined && (Object.hasOwn(dimensions, 'period') || Object.hasOwn(measures, 'period'))) {
    throw new Error(`Client export: dataset "${dataset.name}" has a field named "period", which its time bucket uses. Rename it.`);
  }
  const profile = resolveClientContractProfile(endpoint.profile);
  const limits = narrowClientQueryLimits(dataset.limits, undefined, profile);
  const node: Record<string, unknown> = {
    id,
    kind: metric === undefined ? 'dataset' : 'metric',
    dataset: dataset.name,
    path: mountPath + endpoint.path,
    dimensions,
    measures,
    filters,
    metadata: true,
    limits,
    time: dataset.timeKey === undefined ? null : {
      grains: [...(dataset.timeGrains ?? SUPPORTED_TIME_GRAINS)].sort(),
      defaultTimezone: profile.defaultTimezone,
      timezone: true,
      periodFormat: 'calendar-date-or-local-datetime-v1',
    },
  };
  if (metric === undefined) {
    // An endpoint's default selection is the base measures it can serve.
    const defaultMeasures = baseMeasureNames(dataset.measures).filter(name => Object.hasOwn(measures, name));
    if (defaultMeasures.length > limits.maxMeasures) {
      throw new Error(
        `Client export: dataset "${dataset.name}" selects ${defaultMeasures.length} measures by default, `
        + `more than its measure budget of ${limits.maxMeasures}. Raise limits.maxMeasures.`,
      );
    }
    node.defaultMeasures = defaultMeasures;
  }
  const annotations = datasetEndpointAnnotations(dataset, Object.keys(dimensions), Object.keys(measures), metric);
  if (annotations) node.annotations = annotations;
  return node;
}

/**
 * The client contract for endpoints a host serves from dataset definitions:
 * typed fields, routes and schema hashes that `hypequery generate:client`
 * turns into React types and a route manifest. Pure: no network, no execution.
 * Mirrors Python's `export_client_contract`, so an equivalent definition
 * exports the same contract in either language.
 *
 * The host owns the routes and must enforce the advertised profile on them.
 */
export function buildDatasetClientContract(
  endpoints: readonly DatasetClientEndpoint[],
  options: BuildDatasetClientContractOptions = {},
): PreparedProtocolClientContract {
  const mountPath = options.mountPath ?? '';
  if (mountPath && (!mountPath.startsWith('/') || mountPath.endsWith('/'))) {
    throw new Error('Client export: mountPath must be empty or an absolute path without a trailing slash.');
  }
  return prepareProtocolClientContract({
    kind: 'hypequery-client-contract',
    version: 1,
    view: options.view ?? 'build',
    endpoints: endpoints.map(endpoint => endpointDescriptor(endpoint, mountPath)),
  });
}
