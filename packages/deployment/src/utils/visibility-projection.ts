import type {
  ProtocolDeploymentDataset,
  ProtocolVisibleDatasetFields,
} from '@hypequery/protocol';

type Dimension = ProtocolDeploymentDataset['dimensions'][number];

/**
 * A dimension the principal may neither group nor filter by, with its label,
 * description and semantic metadata removed (RFC 0018).
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
export function narrowDatasetToVisible(
  dataset: ProtocolDeploymentDataset,
  visible: ProtocolVisibleDatasetFields,
): ProtocolDeploymentDataset {
  const { defaults, timeField, ...rest } = dataset;
  const defaultDimensions = defaults?.dimensions?.filter(name => visible.dimensions.has(String(name)));
  const narrowedDefaults = {
    ...(defaultDimensions === undefined || defaultDimensions.length === 0
      ? {}
      : { dimensions: defaultDimensions }),
    ...(defaults?.timeGrain === undefined || !visible.timeField ? {} : { timeGrain: defaults.timeGrain }),
  };
  return {
    ...rest,
    ...(visible.timeField && timeField !== undefined ? { timeField } : {}),
    // An empty `defaults` object is not a valid contract value.
    ...(Object.keys(narrowedDefaults).length === 0 ? {} : { defaults: narrowedDefaults }),
    dimensions: dataset.dimensions.map(dimension => (
      visible.dimensions.has(String(dimension.name)) ? dimension : concealDimension(dimension)
    )),
    measures: dataset.measures.filter(measure => visible.measures.has(String(measure.name))),
    filters: dataset.filters.filter(filter => visible.filters.has(String(filter.name))),
    relationships: dataset.relationships.filter(relationship => (
      visible.relationships.has(String(relationship.name))
    )),
  } as ProtocolDeploymentDataset;
}
