/**
 * Get Dataset Schema Tool
 *
 * Returns the complete schema for a dataset including dimensions, measures,
 * named metrics, filters, and relationships.
 */

import { getDatasetCatalog } from '@hypequery/datasets';
import type {
  DatasetRegistry,
  GetDatasetSchemaArgs,
  MCPToolResponse,
  DatasetSchema,
  DimensionSchema,
  MeasureSchema,
  FilterSchema,
  MetricSchema,
  RelationshipSchema,
  SchemaToolOptions,
} from '../types.js';

function isDatasetInstance(value: unknown): value is Parameters<typeof getDatasetCatalog>[0] {
  return !!value && typeof value === 'object' && (value as { __type?: unknown }).__type === 'dataset';
}

export async function getDatasetSchemaTool(
  datasets: DatasetRegistry,
  args: unknown,
  options: SchemaToolOptions = {},
): Promise<MCPToolResponse> {
  // Parse and validate args
  const validatedArgs = args as GetDatasetSchemaArgs;
  const datasetName = validatedArgs.dataset;

  if (!datasetName) {
    throw new Error('dataset parameter is required');
  }

  const dataset = datasets[datasetName];

  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetName}`);
  }

  const datasetAny = dataset as any;
  const schema: DatasetSchema = {
    name: datasetName,
    description: datasetAny.description || datasetAny.config?.description || '',
    source: datasetAny.source || datasetAny.config?.source || '',
    timeKey: datasetAny.timeKey || datasetAny.config?.timeKey || null,
    tenantKey: datasetAny.tenantKey || datasetAny.config?.tenantKey || null,
    dimensions: {},
    measures: {},
    metrics: {},
    filters: {},
    relationships: {},
    limits: datasetAny.limits,
  };

  if (isDatasetInstance(dataset)) {
    const catalog = getDatasetCatalog(dataset);
    schema.source = catalog.source;
    schema.timeKey = catalog.timeKey ?? null;
    schema.tenantKey = catalog.tenantKey ?? null;
    schema.limits = catalog.limits;

    for (const [name, dimension] of Object.entries(catalog.dimensions)) {
      const dimSchema: DimensionSchema = {
        type: dimension.type,
        column: dimension.column ?? name,
        sql: options.includeSql ? dimension.sql ?? null : null,
        label: dimension.label || name,
        description: dimension.description || '',
        examples: [],
        filterable: dimension.filterable,
        groupable: dimension.groupable,
      };
      schema.dimensions[name] = dimSchema;
    }

    for (const [name, measure] of Object.entries(catalog.measures)) {
      const measureSchema: MeasureSchema = {
        aggregation: measure.aggregation,
        field: measure.field,
        sql: options.includeSql ? measure.sql ?? null : null,
        label: measure.label || name,
        description: measure.description || '',
      };
      schema.measures[name] = measureSchema;
    }

    for (const [name, filter] of Object.entries(catalog.filters)) {
      const filterSchema: FilterSchema = {
        field: filter.field,
        label: filter.label || name,
        description: filter.description || '',
        operators: filter.operators ? [...filter.operators] : null,
      };
      schema.filters[name] = filterSchema;
    }

    for (const [name, metric] of Object.entries(catalog.metrics)) {
      const metSchema: MetricSchema = {
        type: metric.kind,
        aggregation: metric.measures?.join(', ') || '',
        label: metric.label || name,
        description: metric.description || '',
        format: null,
      };
      schema.metrics[name] = metSchema;
    }

    for (const [name, relationship] of Object.entries(catalog.relationships)) {
      const relSchema: RelationshipSchema = {
        type: relationship.kind,
        target: relationship.target,
        from: relationship.from,
        to: relationship.to,
        execution: relationship.execution,
        description: '',
      };
      schema.relationships[name] = relSchema;
    }
  } else {
    // Legacy object-shaped fixtures/configs.
    if (datasetAny.dimensions) {
      for (const [name, dimension] of Object.entries(datasetAny.dimensions)) {
        const dimSchema: DimensionSchema = {
          type: (dimension as { fieldType?: string; type?: string }).fieldType || (dimension as { type?: string }).type || 'unknown',
          column: (dimension as { column?: string }).column || name,
          sql: options.includeSql ? (dimension as { sql?: string }).sql || null : null,
          label: (dimension as { label?: string }).label || name,
          description: (dimension as { description?: string }).description || '',
          examples: (dimension as { examples?: string[] }).examples || [],
          filterable: (dimension as { filterable?: boolean }).filterable !== false,
          groupable: (dimension as { groupable?: boolean }).groupable !== false,
        };
        schema.dimensions[name] = dimSchema;
      }
    }

    if (datasetAny.measures) {
      for (const [name, measure] of Object.entries(datasetAny.measures)) {
        const measureSchema: MeasureSchema = {
          aggregation: (measure as { aggregation?: string; type?: string }).aggregation || (measure as { type?: string }).type || 'unknown',
          field: (measure as { field?: string }).field || name,
          sql: options.includeSql ? (measure as { sql?: string }).sql || null : null,
          label: (measure as { label?: string }).label || name,
          description: (measure as { description?: string }).description || '',
        };
        schema.measures[name] = measureSchema;
      }
    }

    if (datasetAny.filters) {
      for (const [name, filter] of Object.entries(datasetAny.filters)) {
        const filterSchema: FilterSchema = {
          field: (filter as { field?: string }).field || name,
          label: (filter as { label?: string }).label || name,
          description: (filter as { description?: string }).description || '',
          operators: (filter as { operators?: string[] }).operators || null,
        };
        schema.filters[name] = filterSchema;
      }
    }

    if (datasetAny.relationships) {
      for (const [name, relationship] of Object.entries(datasetAny.relationships)) {
        const rel = relationship as any;
        const relSchema: RelationshipSchema = {
          type: rel.type || rel.kind || 'unknown',
          target: typeof rel.target === 'function' ? rel.target()?.name || '' : rel.target || rel.dataset?.name || '',
          from: rel.from,
          to: rel.to,
          execution: rel.execution,
          description: rel.description || '',
        };
        schema.relationships[name] = relSchema;
      }
    }
  }

  // Backward compatibility for legacy object-shaped dataset fixtures.
  if (!isDatasetInstance(dataset) && datasetAny.metrics) {
    for (const [name, metric] of Object.entries(datasetAny.metrics)) {
      const metSchema: MetricSchema = {
        type: (metric as { spec?: { __type?: string }; type?: string }).spec?.__type || (metric as { type?: string }).type || 'unknown',
        aggregation: (metric as { spec?: { aggregation?: string }; aggregation?: string; type?: string }).spec?.aggregation || (metric as { aggregation?: string; type?: string }).aggregation || (metric as { type?: string }).type || '',
        label: (metric as { label?: string }).label || name,
        description: (metric as { description?: string }).description || '',
        format: (metric as { format?: string }).format || null,
      };
      schema.metrics[name] = metSchema;
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(schema, null, 2),
      },
    ],
  };
}
