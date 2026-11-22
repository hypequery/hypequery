import type { SemanticQuerySchemaOptions } from '@hypequery/datasets/schemas';
import type { MCPQueryFeatures } from '../../types.js';

type FeatureOptions = Pick<
  SemanticQuerySchemaOptions,
  'having' | 'filterGroups' | 'relativeDates' | 'fill' | 'timeKey' | 'calculations'
>;

/** The canonical schema options for MCP's features: each on unless turned off. */
export function semanticQueryFeatureOptions(features: MCPQueryFeatures = {}): FeatureOptions {
  return {
    having: features.having !== false,
    filterGroups: features.filterGroups !== false,
    relativeDates: features.relativeDates !== false,
    fill: features.fill !== false,
    timeKey: features.timeKey !== false,
    calculations: features.calculations !== false,
  };
}
