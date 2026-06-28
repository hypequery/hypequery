import type {
  AnyDatasetInstance,
  DatasetQuery,
  ExecutionContext,
  MetricHandle,
  MetricQuery,
  MetricFilter,
  TimeGrain,
} from './types.js';
import {
  getDatasetCatalog,
  getDatasetCatalogs,
  type DatasetCatalog,
  type DatasetCatalogMap,
  type DatasetCatalogSource,
} from './catalog.js';
import { SEMANTIC_FILTER_OPERATORS } from './constants.js';

export type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
};

export interface SemanticToolDefinition<TInput = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(input: TInput, context?: ExecutionContext): Promise<TResult>;
}

export type DatasetToolMode = 'catalog' | 'per-dataset' | 'per-metric';

export interface DatasetToolAnalytics {
  execute(
    target: AnyDatasetInstance | MetricHandle,
    query?: DatasetQuery | MetricQuery,
    context?: ExecutionContext,
  ): Promise<unknown>;
}

export interface GenerateDatasetToolsOptions {
  datasets: Record<string, DatasetCatalogSource>;
  analytics: DatasetToolAnalytics;
  mode?: DatasetToolMode;
  includeSql?: boolean;
}

export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

export interface AISDKToolDefinition {
  description: string;
  parameters: JsonSchema;
  execute(input: Record<string, unknown>): Promise<unknown>;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

function enumSchema(values: string[], description?: string): JsonSchema {
  const unique = Array.from(new Set(values));
  return {
    type: 'string',
    ...(unique.length > 0 ? { enum: unique } : {}),
    ...(description ? { description } : {}),
  };
}

function toolNamePart(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_-]/g, '_');
  return /^[A-Za-z_]/.test(normalized) ? normalized : `_${normalized}`;
}

function arrayEnumSchema(values: string[], description?: string): JsonSchema {
  return {
    type: 'array',
    items: enumSchema(values),
    ...(description ? { description } : {}),
  };
}

function limitSchema(catalogs: DatasetCatalog[]): JsonSchema {
  const finiteLimits = catalogs
    .map(catalog => catalog.maxLimit)
    .filter((limit): limit is number => typeof limit === 'number');

  return {
    type: 'integer',
    minimum: 0,
    ...(finiteLimits.length > 0 ? { maximum: Math.max(...finiteLimits) } : {}),
  };
}

function querySchema(catalogs: DatasetCatalog[], includeDataset: boolean): JsonSchema {
  const datasetNames = catalogs.map(catalog => catalog.name);
  const dimensionNames = Array.from(
    new Set(catalogs.flatMap(catalog => Object.keys(catalog.dimensions))),
  );
  const measureNames = Array.from(
    new Set(catalogs.flatMap(catalog => Object.keys(catalog.measures))),
  );
  const filterNames = Array.from(
    new Set(catalogs.flatMap(catalog => Object.keys(catalog.filters))),
  );
  const grainNames = Array.from(
    new Set(catalogs.flatMap(catalog => catalog.supportedGrains)),
  );
  const orderFields = Array.from(
    new Set(catalogs.flatMap(catalog => catalog.orderableFields)),
  );

  const properties: Record<string, JsonSchema> = {
    dimensions: arrayEnumSchema(dimensionNames, 'Dimensions to group by.'),
    measures: arrayEnumSchema(measureNames, 'Measures to aggregate.'),
    filters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: enumSchema(filterNames),
          operator: enumSchema([...SEMANTIC_FILTER_OPERATORS]),
          value: {},
        },
        required: ['field', 'operator', 'value'],
        additionalProperties: false,
      },
    },
    orderBy: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: enumSchema(orderFields),
          direction: enumSchema(['asc', 'desc']),
        },
        required: ['field', 'direction'],
        additionalProperties: false,
      },
    },
    by: enumSchema(grainNames, 'Optional time grain.'),
    limit: limitSchema(catalogs),
    offset: {
      type: 'integer',
      minimum: 0,
    },
  };

  if (includeDataset) {
    properties.dataset = enumSchema(datasetNames);
  }

  return {
    type: 'object',
    properties,
    required: includeDataset ? ['dataset'] : [],
    additionalProperties: false,
  };
}

function assertStringArray(input: unknown, name: string): string[] {
  if (input == null) return [];
  if (!Array.isArray(input) || input.some(value => typeof value !== 'string')) {
    throw new Error(`Invalid ${name}: expected an array of strings.`);
  }
  return input;
}

function assertFilters(input: unknown): MetricFilter[] {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new Error('Invalid filters: expected an array.');
  }

  return input.map((filter, index) => {
    if (!filter || typeof filter !== 'object') {
      throw new Error(`Invalid filters[${index}]: expected an object.`);
    }
    const candidate = filter as Partial<MetricFilter>;
    if (typeof candidate.field !== 'string') {
      throw new Error(`Invalid filters[${index}].field: expected a string.`);
    }
    if (!SEMANTIC_FILTER_OPERATORS.includes(candidate.operator as MetricFilter['operator'])) {
      throw new Error(`Invalid filters[${index}].operator: expected a supported operator.`);
    }
    return {
      field: candidate.field,
      operator: candidate.operator as MetricFilter['operator'],
      value: candidate.value,
    };
  });
}

function assertOrderBy(input: unknown): NonNullable<DatasetQuery['orderBy']> {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new Error('Invalid orderBy: expected an array.');
  }

  return input.map((order, index) => {
    if (!order || typeof order !== 'object') {
      throw new Error(`Invalid orderBy[${index}]: expected an object.`);
    }
    const candidate = order as { field?: unknown; direction?: unknown };
    if (typeof candidate.field !== 'string') {
      throw new Error(`Invalid orderBy[${index}].field: expected a string.`);
    }
    if (candidate.direction !== 'asc' && candidate.direction !== 'desc') {
      throw new Error(`Invalid orderBy[${index}].direction: expected "asc" or "desc".`);
    }
    return {
      field: candidate.field,
      direction: candidate.direction,
    };
  });
}

function assertNonNegativeInteger(input: unknown, name: string): number | undefined {
  if (input == null) return undefined;
  if (!Number.isInteger(input) || (input as number) < 0) {
    throw new Error(`Invalid ${name}: expected a non-negative integer.`);
  }
  return input as number;
}

function assertAllowedValues(values: string[], allowed: string[], label: string): void {
  const invalid = values.filter(value => !allowed.includes(value));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid ${label}: ${invalid.join(', ')}. Available: ${allowed.join(', ') || '(none)'}.`,
    );
  }
}

function normalizeDatasetQuery(
  input: Record<string, unknown>,
  catalog: DatasetCatalog,
  options: { orderableFields?: string[] } = {},
): DatasetQuery {
  const dimensions = assertStringArray(input.dimensions, 'dimensions');
  const measures = assertStringArray(input.measures, 'measures');
  const filters = assertFilters(input.filters);
  const orderBy = assertOrderBy(input.orderBy);
  const limit = assertNonNegativeInteger(input.limit, 'limit');
  const offset = assertNonNegativeInteger(input.offset, 'offset');
  let by: TimeGrain | undefined;

  assertAllowedValues(dimensions, Object.keys(catalog.dimensions), 'dimensions');
  assertAllowedValues(measures, Object.keys(catalog.measures), 'measures');
  assertAllowedValues(filters.map(filter => filter.field), Object.keys(catalog.filters), 'filter fields');
  assertAllowedValues(
    orderBy.map(order => order.field),
    options.orderableFields ?? catalog.orderableFields,
    'orderBy fields',
  );

  for (const filter of filters) {
    const allowedOperators = catalog.filters[filter.field]?.operators ?? [];
    if (!allowedOperators.includes(filter.operator)) {
      throw new Error(
        `Invalid filter operator for "${filter.field}": ${filter.operator}. Allowed: ${allowedOperators.join(', ')}.`,
      );
    }
  }

  if (typeof input.by === 'string') {
    assertAllowedValues([input.by], catalog.supportedGrains, 'time grain');
    by = input.by as TimeGrain;
  } else if (input.by != null) {
    throw new Error('Invalid by: expected a time grain string.');
  }

  if (limit != null && catalog.maxLimit != null && limit > catalog.maxLimit) {
    throw new Error(`Invalid limit: ${limit}. Max: ${catalog.maxLimit}.`);
  }

  return {
    ...(dimensions.length > 0 ? { dimensions } : {}),
    ...(measures.length > 0 ? { measures } : {}),
    ...(filters.length > 0 ? { filters } : {}),
    ...(orderBy.length > 0 ? { orderBy } : {}),
    ...(by ? { by } : {}),
    ...(limit != null ? { limit } : {}),
    ...(offset != null ? { offset } : {}),
  };
}

function redactSql(result: unknown, includeSql: boolean): unknown {
  if (includeSql || !result || typeof result !== 'object') {
    return result;
  }

  const resultObject = result as { meta?: Record<string, unknown> };
  if (!resultObject.meta || typeof resultObject.meta !== 'object' || !('sql' in resultObject.meta)) {
    return result;
  }

  const { sql: _sql, ...meta } = resultObject.meta;
  return {
    ...resultObject,
    meta,
  };
}

function buildCatalogTool(
  datasets: Record<string, DatasetCatalogSource>,
  catalogs: DatasetCatalogMap,
  analytics: DatasetToolAnalytics,
  includeSql: boolean,
): SemanticToolDefinition {
  const catalogList = Object.values(catalogs);

  return {
    name: 'query_dataset',
    description: 'Query governed analytics datasets by selecting dimensions, measures, filters, and time grains.',
    parameters: querySchema(catalogList, true),
    async execute(input: Record<string, unknown>, context?: ExecutionContext): Promise<unknown> {
      if (typeof input.dataset !== 'string' || !datasets[input.dataset]) {
        throw new Error(`Invalid dataset: ${String(input.dataset)}. Available: ${Object.keys(datasets).join(', ')}.`);
      }

      const catalog = catalogs[input.dataset];
      const query = normalizeDatasetQuery(input, catalog);
      const result = await analytics.execute(datasets[input.dataset], query, context);
      return redactSql(result, includeSql);
    },
  };
}

function buildDatasetTools(
  datasets: Record<string, DatasetCatalogSource>,
  catalogs: DatasetCatalogMap,
  analytics: DatasetToolAnalytics,
  includeSql: boolean,
): SemanticToolDefinition[] {
  return Object.entries(datasets).map(([datasetName, dataset]) => {
    const catalog = catalogs[datasetName];
    return {
      name: `query_${toolNamePart(datasetName)}`,
      description: `Query the ${datasetName} analytics dataset.`,
      parameters: querySchema([catalog], false),
      async execute(input: Record<string, unknown>, context?: ExecutionContext): Promise<unknown> {
        const query = normalizeDatasetQuery(input, catalog);
        const result = await analytics.execute(dataset, query, context);
        return redactSql(result, includeSql);
      },
    };
  });
}

function metricQuerySchema(catalog: DatasetCatalog, metricName: string): JsonSchema {
  const schema = querySchema([catalog], false);
  const properties = schema.properties ?? {};
  delete properties.measures;
  properties.orderBy = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        field: enumSchema([...Object.keys(catalog.dimensions), metricName, ...(catalog.timeKey ? ['period'] : [])]),
        direction: enumSchema(['asc', 'desc']),
      },
      required: ['field', 'direction'],
      additionalProperties: false,
    },
  };
  return {
    ...schema,
    properties,
  };
}

function buildMetricTools(
  datasets: Record<string, DatasetCatalogSource>,
  catalogs: DatasetCatalogMap,
  analytics: DatasetToolAnalytics,
  includeSql: boolean,
): SemanticToolDefinition[] {
  const tools: SemanticToolDefinition[] = [];

  for (const [datasetName, dataset] of Object.entries(datasets)) {
    const catalog = catalogs[datasetName];
    for (const [metricName, metric] of Object.entries(dataset.metrics ?? {})) {
      tools.push({
        name: `query_${toolNamePart(metricName)}`,
        description: `Query the ${metricName} metric from the ${datasetName} dataset.`,
        parameters: metricQuerySchema(catalog, metricName),
        async execute(input: Record<string, unknown>, context?: ExecutionContext): Promise<unknown> {
          const orderableFields = [
            ...Object.keys(catalog.dimensions),
            metricName,
            ...(catalog.timeKey ? ['period'] : []),
          ];
          const query = normalizeDatasetQuery(
            { ...input, measures: [] },
            catalog,
            { orderableFields },
          );
          const result = await analytics.execute(metric, query, context);
          return redactSql(result, includeSql);
        },
      });
    }
  }

  return tools;
}

export function generateDatasetTools(options: GenerateDatasetToolsOptions): SemanticToolDefinition[] {
  const mode = options.mode ?? 'catalog';
  const catalogs = getDatasetCatalogs(options.datasets);

  if (mode === 'catalog') {
    return [
      buildCatalogTool(options.datasets, catalogs, options.analytics, options.includeSql ?? false),
    ];
  }

  if (mode === 'per-dataset') {
    return buildDatasetTools(options.datasets, catalogs, options.analytics, options.includeSql ?? false);
  }

  return buildMetricTools(options.datasets, catalogs, options.analytics, options.includeSql ?? false);
}

export function toOpenAITools(tools: SemanticToolDefinition[]): OpenAIToolDefinition[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function toAISDKTools(tools: SemanticToolDefinition[]): Record<string, AISDKToolDefinition> {
  return Object.fromEntries(
    tools.map(tool => [
      tool.name,
      {
        description: tool.description,
        parameters: tool.parameters,
        execute: input => tool.execute(input),
      },
    ]),
  );
}

export function toMcpTools(tools: SemanticToolDefinition[]): McpToolDefinition[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }));
}

export { getDatasetCatalog };
