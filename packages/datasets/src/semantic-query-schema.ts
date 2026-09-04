import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  getDatasetCatalog,
  getQueryableRelationshipFields,
  type DatasetCatalog,
  type DatasetCatalogSource,
  type MetricCatalogEntry,
} from './catalog.js';
import { SEMANTIC_FILTER_OPERATORS } from './constants.js';
import type { JsonSchema } from './tools.js';
import { compareStrings, stableStringify, uniqueSorted } from './utils/canonical-json.js';

export interface SemanticQuerySchemaLimits {
  defaultResultSize?: number;
  maxResultSize?: number;
  maxOffset?: number;
  maxDimensions?: number;
  maxMeasures?: number;
  maxFilters?: number;
  maxOrderBy?: number;
}

export interface SemanticQuerySchemaOptions extends SemanticQuerySchemaLimits {
  /** Input field used for time grain. Serve uses `by`; agent tools use `grain`. */
  grainField?: 'by' | 'grain';
  /** Include Serve's opt-in result metadata flag. */
  includeMeta?: boolean;
  /** Require at least one dimension or measure for dataset queries. */
  requireSelection?: boolean;
  /** Validate result limits in the schema. Disable when a consumer clamps them. */
  enforceResultLimit?: boolean;
}

/** Metric-specific query capabilities used when they are not embedded in the Dataset source. */
export type SemanticMetricQueryContract = Pick<
  MetricCatalogEntry,
  'dimensions' | 'filters' | 'grains' | 'grain'
>;

export const DEFAULT_SEMANTIC_QUERY_SCHEMA_LIMITS = Object.freeze({
  maxResultSize: 10_000,
  maxOffset: 10_000,
  maxDimensions: 50,
  maxMeasures: 50,
  maxFilters: 100,
  maxOrderBy: 50,
});

export interface CanonicalSemanticQuerySchemas {
  readonly queryDataset: ZodTypeAny;
  readonly queryMetric: ZodTypeAny;
  readonly queryDatasetJsonSchema: JsonSchema;
  readonly queryMetricJsonSchema: JsonSchema;
  readonly manifestHash: string;
}

/** A live local Dataset or an already-normalized catalog from a hosted contract. */
export type SemanticQuerySchemaSource = DatasetCatalogSource | DatasetCatalog;

function isDatasetCatalog(source: SemanticQuerySchemaSource): source is DatasetCatalog {
  return 'requiresTenant' in source && 'supportedGrains' in source && 'orderableFields' in source;
}

function resolveCatalog(source: SemanticQuerySchemaSource): DatasetCatalog {
  return isDatasetCatalog(source)
    ? source
    : getDatasetCatalog(source);
}

function lowerLimit(...values: Array<number | undefined>): number | undefined {
  const finite = values.filter((value): value is number => value !== undefined);
  return finite.length > 0 ? Math.min(...finite) : undefined;
}

function fieldEnum(values: string[]): ZodTypeAny {
  const unique = uniqueSorted(values);
  return unique.length > 0
    ? z.enum(unique as [string, ...string[]])
    : z.never();
}

function boundedArray(item: ZodTypeAny, maximum?: number): ZodTypeAny {
  const array = z.array(item);
  return (maximum === undefined ? array : array.max(maximum)).optional();
}

function filterSchema(catalog: DatasetCatalog, fields: string[]): ZodTypeAny {
  const filterValue = z.unknown().refine(value => value !== undefined, 'Required');
  const relationshipFields = new Set(getQueryableRelationshipFields(catalog));
  const variants: ZodTypeAny[] = uniqueSorted(fields).map((field) => z.object({
    field: z.literal(field),
    operator: relationshipFields.has(field)
      ? z.enum(SEMANTIC_FILTER_OPERATORS)
      : fieldEnum(catalog.filters[field]?.operators ?? [...SEMANTIC_FILTER_OPERATORS]),
    value: filterValue,
  }).strict());

  if (variants.length === 0) {
    return z.object({
      field: z.never(),
      operator: z.enum(SEMANTIC_FILTER_OPERATORS),
      value: filterValue,
    }).strict();
  }
  if (variants.length === 1) return variants[0];
  return z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

function queryShape(
  catalog: DatasetCatalog,
  metricName: string | undefined,
  options: SemanticQuerySchemaOptions,
  metric?: SemanticMetricQueryContract,
  localRelationshipFields: string[] = [],
): Record<string, ZodTypeAny> {
  const limits = { ...DEFAULT_SEMANTIC_QUERY_SCHEMA_LIMITS, ...options };
  const relationshipFields = getQueryableRelationshipFields(catalog);
  // `groupable: false` declares a dimension that exists to back a measure, not
  // to be selected. The agent-safe catalog already hides those, so the
  // generated schema must refuse them too — otherwise a dataset advertises one
  // set of dimensions and accepts another. A relationship-qualified name is not
  // a local dimension, so it passes through untouched.
  const isGroupable = (name: string) => catalog.dimensions[name]?.groupable !== false;
  const dimensions = metric
    ? uniqueSorted([...metric.dimensions.filter(isGroupable), ...localRelationshipFields])
    : uniqueSorted([...Object.keys(catalog.dimensions).filter(isGroupable), ...relationshipFields]);
  const declaredFilters = Object.keys(catalog.filters);
  const filterFields = metric
    ? uniqueSorted([...metric.filters, ...localRelationshipFields])
    : metricName
      ? uniqueSorted([
          ...(declaredFilters.length > 0 ? declaredFilters : Object.keys(catalog.dimensions)),
          ...relationshipFields,
        ])
      : uniqueSorted([...declaredFilters, ...relationshipFields]);
  const grains = metric
    ? metric.grain ? [metric.grain] : metric.grains
    : catalog.supportedGrains;
  const orderable = metricName
    ? uniqueSorted([...dimensions, metricName, ...(grains.length > 0 ? ['period'] : [])])
    : uniqueSorted([
        ...dimensions,
        ...Object.keys(catalog.measures),
        ...(catalog.supportedGrains.length > 0 ? ['period'] : []),
      ]);
  const maxResultSize = options.enforceResultLimit === false
    ? undefined
    : lowerLimit(catalog.limits?.maxResultSize, limits.maxResultSize);
  const defaultResultSize = options.defaultResultSize === undefined
    ? undefined
    : lowerLimit(options.defaultResultSize, maxResultSize);
  const grainField = options.grainField ?? 'by';
  const limitSchema = maxResultSize === undefined
    ? z.number().int().positive()
    : z.number().int().positive().max(maxResultSize);

  return {
    dimensions: boundedArray(
      fieldEnum(dimensions),
      lowerLimit(catalog.limits?.maxDimensions, limits.maxDimensions),
    ),
    ...(metricName ? {} : {
      measures: boundedArray(
        fieldEnum(Object.keys(catalog.measures)),
        lowerLimit(catalog.limits?.maxMeasures, limits.maxMeasures),
      ),
    }),
    filters: boundedArray(
      filterSchema(catalog, filterFields),
      lowerLimit(catalog.limits?.maxFilters, limits.maxFilters),
    ),
    orderBy: boundedArray(z.object({
      field: fieldEnum(orderable),
      direction: z.enum(['asc', 'desc']),
    }).strict(), limits.maxOrderBy),
    limit: defaultResultSize === undefined
      ? limitSchema.optional()
      : limitSchema.default(defaultResultSize),
    offset: (limits.maxOffset === undefined
      ? z.number().int().nonnegative()
      : z.number().int().nonnegative().max(limits.maxOffset)).optional(),
    [grainField]: fieldEnum(grains).optional(),
    ...(options.includeMeta ? { includeMeta: z.boolean().optional() } : {}),
  };
}

export function buildDatasetInputSchema(
  dataset: SemanticQuerySchemaSource,
  options: SemanticQuerySchemaOptions = {},
): ZodTypeAny {
  const schema = z.object(queryShape(resolveCatalog(dataset), undefined, options)).strict();
  if (options.requireSelection === false) return schema;
  return schema.refine(
    input => (input.dimensions?.length ?? 0) > 0 || (input.measures?.length ?? 0) > 0,
    { message: 'At least one dimension or measure must be specified' },
  );
}

export function buildMetricInputSchema(
  dataset: SemanticQuerySchemaSource,
  metricName: string,
  options: SemanticQuerySchemaOptions = {},
  metricContract?: SemanticMetricQueryContract,
): ZodTypeAny {
  const catalog = resolveCatalog(dataset);
  const metric = metricContract ?? catalog.metrics[metricName];
  const localRelationshipFields = isDatasetCatalog(dataset)
    ? []
    : getQueryableRelationshipFields(catalog);
  return z.object(queryShape(
    catalog,
    metricName,
    options,
    metric,
    localRelationshipFields,
  )).strict();
}

function unionSchemas(schemas: ZodTypeAny[], emptyShape: Record<string, ZodTypeAny>): ZodTypeAny {
  if (schemas.length === 0) return z.object(emptyShape).strict();
  if (schemas.length === 1) return schemas[0];
  return z.union(schemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

function withSelectors(
  schema: ZodTypeAny,
  selectors: Record<string, ZodTypeAny>,
  requireSelection: boolean,
): ZodTypeAny {
  const shape = (schema instanceof z.ZodEffects ? schema.innerType() : schema).shape;
  const selected = z.object({ ...selectors, ...shape }).strict();
  if (!requireSelection) return selected;
  return selected.refine(
    input => (input.dimensions?.length ?? 0) > 0 || (input.measures?.length ?? 0) > 0,
    { message: 'At least one dimension or measure must be specified' },
  );
}

export function toSemanticJsonSchema(
  schema: ZodTypeAny,
  options: { requireSelection?: boolean } = {},
): JsonSchema {
  const converted = zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' });
  const { $schema: _schema, ...jsonSchema } = converted;
  const result = jsonSchema as JsonSchema;
  const objectSchema = result.anyOf && !result.type ? { ...result, type: 'object' } : result;
  return options.requireSelection ? addSelectionRequirement(objectSchema) : objectSchema;
}

function addSelectionRequirement(schema: JsonSchema): JsonSchema {
  return {
    ...schema,
    allOf: [
      ...(schema.allOf ?? []),
      {
        anyOf: [
          {
            type: 'object',
            properties: { dimensions: { type: 'array', minItems: 1 } },
            required: ['dimensions'],
          },
          {
            type: 'object',
            properties: { measures: { type: 'array', minItems: 1 } },
            required: ['measures'],
          },
        ],
      },
    ],
  };
}

export function buildCanonicalSemanticQuerySchemas(
  datasets: Record<string, SemanticQuerySchemaSource>,
  options: SemanticQuerySchemaOptions = {},
): CanonicalSemanticQuerySchemas {
  const datasetSchemas: ZodTypeAny[] = [];
  const metricSchemas: ZodTypeAny[] = [];

  for (const [datasetName, dataset] of Object.entries(datasets)
    .sort(([left], [right]) => compareStrings(left, right))) {
    datasetSchemas.push(withSelectors(
      buildDatasetInputSchema(dataset, { ...options, requireSelection: false }),
      { dataset: z.literal(datasetName) },
      options.requireSelection !== false,
    ));
    const catalog = resolveCatalog(dataset);
    for (const metricName of Object.keys(catalog.metrics).sort(compareStrings)) {
      metricSchemas.push(withSelectors(
        buildMetricInputSchema(dataset, metricName, options, catalog.metrics[metricName]),
        { dataset: z.literal(datasetName), metric: z.literal(metricName) },
        false,
      ));
    }
  }

  const queryDataset = unionSchemas(datasetSchemas, { dataset: z.never() });
  const queryMetric = unionSchemas(metricSchemas, {
    dataset: z.never(),
    metric: z.never(),
  });
  const queryDatasetJsonSchema = toSemanticJsonSchema(queryDataset, {
    requireSelection: options.requireSelection !== false,
  });
  const queryMetricJsonSchema = toSemanticJsonSchema(queryMetric);
  const manifestHash = bytesToHex(sha256(new TextEncoder().encode(stableStringify({
    query_dataset: queryDatasetJsonSchema,
    query_metric: queryMetricJsonSchema,
  }))));

  return Object.freeze({
    queryDataset,
    queryMetric,
    queryDatasetJsonSchema,
    queryMetricJsonSchema,
    manifestHash,
  });
}
