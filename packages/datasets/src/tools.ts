import type {
  AnyDatasetInstance,
  DatasetQuery,
  ExecutionContext,
  MetricHandle,
  MetricQuery,
} from './types.js';
import {
  getDatasetCatalog,
  type DatasetCatalogSource,
} from './catalog.js';
import {
  buildCanonicalSemanticQuerySchemas,
  buildDatasetInputSchema,
  buildMetricInputSchema,
  toSemanticJsonSchema,
} from './semantic-query-schema.js';
import {
  parseCanonicalToolInput,
  redactSemanticToolSql,
  semanticToolNamePart,
} from './utils/semantic-tool.js';

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
  minItems?: number;
  maxItems?: number;
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  const?: string;
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

function buildCatalogTool(
  datasets: Record<string, DatasetCatalogSource>,
  analytics: DatasetToolAnalytics,
  includeSql: boolean,
): SemanticToolDefinition {
  const schemas = buildCanonicalSemanticQuerySchemas(datasets);

  return {
    name: 'query_dataset',
    description: 'Query governed analytics datasets by selecting dimensions, measures, filters, and time grains.',
    parameters: schemas.queryDatasetJsonSchema,
    async execute(input: Record<string, unknown>, context?: ExecutionContext): Promise<unknown> {
      const parsed = parseCanonicalToolInput(schemas.queryDataset, input, 'dataset query');
      const { dataset: datasetName, ...query } = parsed;
      const result = await analytics.execute(
        datasets[datasetName as string],
        query as DatasetQuery,
        context,
      );
      return redactSemanticToolSql(result, includeSql);
    },
  };
}

function buildDatasetTools(
  datasets: Record<string, DatasetCatalogSource>,
  analytics: DatasetToolAnalytics,
  includeSql: boolean,
): SemanticToolDefinition[] {
  return Object.entries(datasets).map(([datasetName, dataset]) => {
    const schema = buildDatasetInputSchema(dataset);
    return {
      name: `query_${semanticToolNamePart(datasetName)}`,
      description: `Query the ${datasetName} analytics dataset.`,
      parameters: toSemanticJsonSchema(schema, { requireSelection: true }),
      async execute(input: Record<string, unknown>, context?: ExecutionContext): Promise<unknown> {
        const query = parseCanonicalToolInput(schema, input, `${datasetName} query`) as DatasetQuery;
        const result = await analytics.execute(dataset, query, context);
        return redactSemanticToolSql(result, includeSql);
      },
    };
  });
}

function buildMetricTools(
  datasets: Record<string, DatasetCatalogSource>,
  analytics: DatasetToolAnalytics,
  includeSql: boolean,
): SemanticToolDefinition[] {
  const tools: SemanticToolDefinition[] = [];

  for (const [datasetName, dataset] of Object.entries(datasets)) {
    for (const [metricName, metric] of Object.entries(dataset.metrics ?? {})) {
      const schema = buildMetricInputSchema(dataset, metricName);
      tools.push({
        name: `query_${semanticToolNamePart(metricName)}`,
        description: `Query the ${metricName} metric from the ${datasetName} dataset.`,
        parameters: toSemanticJsonSchema(schema),
        async execute(input: Record<string, unknown>, context?: ExecutionContext): Promise<unknown> {
          const query = parseCanonicalToolInput(schema, input, `${metricName} metric query`) as MetricQuery;
          const result = await analytics.execute(metric, query, context);
          return redactSemanticToolSql(result, includeSql);
        },
      });
    }
  }

  return tools;
}

export function generateDatasetTools(options: GenerateDatasetToolsOptions): SemanticToolDefinition[] {
  const mode = options.mode ?? 'catalog';

  if (mode === 'catalog') {
    return [
      buildCatalogTool(options.datasets, options.analytics, options.includeSql ?? false),
    ];
  }

  if (mode === 'per-dataset') {
    return buildDatasetTools(options.datasets, options.analytics, options.includeSql ?? false);
  }

  return buildMetricTools(options.datasets, options.analytics, options.includeSql ?? false);
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
