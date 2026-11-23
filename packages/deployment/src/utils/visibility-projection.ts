import { datasetAllowedFilters, withDatasetAllowedFilters } from '@hypequery/protocol';
import type {
  ProtocolDeploymentDataset,
  ProtocolDeploymentDatasetAnyVersion,
  ProtocolDeploymentDatasetV3,
  ProtocolVisibleDatasetFields,
} from '@hypequery/protocol';
import { isTimeAxisVisible } from './field-backing-column.js';

type Dimension = ProtocolDeploymentDataset['dimensions'][number];

/**
 * A dimension the principal may neither group nor filter by, with its label,
 * description and semantic metadata removed (RFC 0019).
 *
 * It stays in the contract because measures, relationships and the tenant key
 * may reference it. The agent-safe catalog omits a dimension that is neither
 * groupable nor filterable; a consumer serving the projected contract itself
 * still sees its name, type and source, so that contract is not a
 * disclosure-safe artifact on its own.
 */
export function concealDimension(dimension: Dimension): Dimension {
  return {
    name: dimension.name,
    type: dimension.type,
    source: dimension.source,
    filterable: false,
    groupable: false,
  } as Dimension;
}

/**
 * A published dataset narrowed to what a visibility policy shows, from the
 * same resolution the data plane enforces. Hidden measures and filters go;
 * hidden dimensions are concealed; a relationship whose keys or target are
 * hidden goes with every field it would contribute; a hidden time field and
 * the defaults that depend on it go. The result is still a valid dataset.
 */
export function narrowDatasetToVisible<TDataset extends ProtocolDeploymentDatasetAnyVersion>(
  dataset: TDataset,
  visible: ProtocolVisibleDatasetFields,
): TDataset {
  const { defaults, timeField, events, ...rest } = dataset as TDataset & { alternateTimeFields?: readonly string[] };
  const { alternateTimeFields, ...withoutAlternates } = rest as typeof rest & { alternateTimeFields?: readonly string[] };
  // RFC 0029: an alternate axis shows only beside a visible default axis, and
  // only when a dimension naming it or reading its column is visible, so a
  // hidden one is never named.
  const visibleAlternates = visible.timeField
    ? alternateTimeFields?.filter(name => isTimeAxisVisible(dataset, String(name), visible.dimensions))
    : undefined;
  const defaultDimensions = defaults?.dimensions?.filter(name => visible.dimensions.has(String(name)));
  // RFC 0027: event operations need the entity and the event time. Without
  // either, the dataset stays discoverable without them; a hidden event
  // dimension only narrows the declaration, as the field is optional.
  const visibleEvents = events === undefined || !visible.timeField || !visible.dimensions.has(String(events.entity))
    ? undefined
    : events.event === undefined || visible.dimensions.has(String(events.event))
      ? events
      : { entity: events.entity };
  const narrowedDefaults = {
    ...(defaultDimensions === undefined || defaultDimensions.length === 0
      ? {}
      : { dimensions: defaultDimensions }),
    ...(defaults?.timeGrain === undefined || !visible.timeField ? {} : { timeGrain: defaults.timeGrain }),
  };
  return withDatasetAllowedFilters({
    ...withoutAlternates,
    ...(visible.timeField && timeField !== undefined ? { timeField } : {}),
    ...(visibleEvents === undefined ? {} : { events: visibleEvents }),
    ...(visibleAlternates === undefined || visibleAlternates.length === 0 ? {} : { alternateTimeFields: visibleAlternates }),
    // An empty `defaults` object is not a valid contract value.
    ...(Object.keys(narrowedDefaults).length === 0 ? {} : { defaults: narrowedDefaults }),
    dimensions: dataset.dimensions.map(dimension => (
      visible.dimensions.has(String(dimension.name)) ? dimension : concealDimension(dimension)
    )),
    measures: (dataset.measures as readonly { readonly name: unknown }[])
      .filter(measure => visible.measures.has(String(measure.name))),
    ...((dataset as ProtocolDeploymentDatasetV3).segments === undefined ? {} : {
      segments: (dataset as ProtocolDeploymentDatasetV3).segments!
        .filter(segment => visible.segments?.has(String(segment.name)) ?? true),
    }),
    relationships: dataset.relationships.filter(relationship => (
      visible.relationships.has(String(relationship.name))
    )),
  } as unknown as TDataset, datasetAllowedFilters(dataset).filter(filter => visible.filters.has(String(filter.name))));
}
