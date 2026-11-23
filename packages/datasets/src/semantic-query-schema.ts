import { isQueryTimezone } from './utils/query-timezone.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { z, type ZodTypeAny } from 'zod';
import {
  getDatasetCatalog,
  getGroupableRelationshipFields,
  getQueryableRelationshipFields,
  getQueryableRelationshipMeasures,
  type DatasetCatalog,
  type DatasetCatalogSource,
  type MetricCatalogEntry,
} from './catalog.js';
import { SEMANTIC_FILTER_OPERATORS, SEMANTIC_HAVING_OPERATORS } from './constants.js';
import type { JsonSchema } from './tools.js';
import type { AnyDatasetInstance } from './types.js';
import type { ProtocolSchema } from '@hypequery/protocol';
import { zodToProtocolSchema } from './protocol-schema-adapter.js';
import { compareStrings, stableStringify, uniqueSorted } from './utils/canonical-json.js';
import { zodToDraft7JsonSchema } from './utils/zod-json-schema.js';
import type { AnyZodSchema } from './utils/zod-schema-version.js';
import { datasetTimeKeys } from './utils/dataset-time-keys.js';
import { effectiveFilters, type FilterPolicy } from './utils/effective-filters.js';
import {
  fieldEnum,
  filterItemSchema,
  filterLeafVariants,
  isTimeAxisFilter,
  isTimestampFilter,
  relativeDateFilterFields,
} from './utils/query-schema-filters.js';
import {
  calculationMeasures,
  calculationShape,
  referenceSchema,
  refineCalculationReferences,
} from './utils/query-schema-calculations.js';

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
  /**
   * Accept `having` conditions on dataset queries. Off by default: enable it
   * only on surfaces that execute through the dataset client. The deployment
   * protocol does not carry post-aggregation conditions yet.
   */
  having?: boolean;
  /**
   * Accept a `timeKey` selection on datasets that declare alternate time axes.
   * Off by default, like `having`: enable it only on surfaces that pass the
   * field through to the dataset client.
   */
  timeKey?: boolean;
  /**
   * Accept `and` / `or` / `not` filter groups beside flat comparisons (RFC
   * 0029). Each comparison keeps its field's operators. Off by default: enable
   * it on surfaces whose executor runs groups rather than flattening them.
   * Turning it on also compacts comparisons into one shape per operator set.
   */
  filterGroups?: boolean;
  /** Accept `inDateRange` relative ranges on time-axis filters (RFC 0029). Off by default. */
  relativeDates?: boolean;
  /** Accept `fill` on dataset queries over a dataset with a time axis (RFC 0029). Off by default. */
  fill?: boolean;
  /**
   * Accept query-scoped `calculations`, `limitBy` and `other` on dataset
   * queries (RFC 0026), and let `orderBy` and `having` name calculation
   * outputs. Off by default: these need an executor that plans them, which on
   * the wire means expression extension 2.
   */
  calculations?: boolean;
  /** Include Serve's opt-in result metadata flag. */
  includeMeta?: boolean;
  /** Require at least one dimension or measure for dataset queries. */
  requireSelection?: boolean;
  /** Validate result limits in the schema. Disable when a consumer clamps them. */
  enforceResultLimit?: boolean;
  /**
   * Datasets that may be queried directly. Defaults to all of them.
   *
   * A dataset outside this list still contributes its metrics and can still be
   * joined to, but is not offered as a `query_dataset` target. That split is not
   * hypothetical: a deployment contract authorizes a dataset and each of its
   * metrics through separate endpoint policies, so a caller can be entitled to
   * a metric on a dataset it may not query directly. Compiling one schema for
   * both would either advertise a target the caller cannot use or hide a metric
   * it can.
   */
  queryableDatasets?: readonly string[];
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

function localFilterPolicy(
  source: SemanticQuerySchemaSource,
): Readonly<Record<string, FilterPolicy>> {
  return isDatasetCatalog(source)
    ? effectiveFilters(source)
    : effectiveFilters(source);
}

function relationshipFilterPolicy(source: SemanticQuerySchemaSource): ReadonlyMap<string, string[]> {
  const fields = new Map<string, string[]>();
  // A serialized catalog has no target filter allowlist. Do not infer one
  // from its queryable fields: a field may be selectable but not filterable.
  if (isDatasetCatalog(source)) return fields;
  for (const [name, relationship] of Object.entries(source.relationships)) {
    if (relationship.kind === 'hasMany') continue;
    const target = relationship.target() as AnyDatasetInstance;
    const filters = effectiveFilters(target);
    for (const [field, dimension] of Object.entries(target.dimensions)) {
      const definition = filters[field];
      if (!dimension.sql && definition?.field === field) {
        fields.set(`${name}.${field}`, definition.operators
          ? [...definition.operators]
          : [...SEMANTIC_FILTER_OPERATORS]);
      }
    }
  }
  return fields;
}

function lowerLimit(...values: Array<number | undefined>): number | undefined {
  const finite = values.filter((value): value is number => value !== undefined);
  return finite.length > 0 ? Math.min(...finite) : undefined;
}

function boundedArray(item: ZodTypeAny, maximum?: number): ZodTypeAny {
  const array = z.array(item);
  return (maximum === undefined ? array : array.max(maximum)).optional();
}

/**
 * Post-aggregation conditions on selected measures. That a condition names a
 * *selected* measure depends on the rest of the input, so it is enforced by
 * query validation rather than expressed here.
 */
function havingSchema(measures: string[], maximum?: number, outputs = false): ZodTypeAny {
  // With calculations, a condition may also name one of their outputs.
  const measure = outputs ? z.union([fieldEnum(measures), referenceSchema()]) : fieldEnum(measures);
  const number = z.number().finite();
  const comparisons = SEMANTIC_HAVING_OPERATORS.filter(
    operator => operator !== 'between' && operator !== 'in' && operator !== 'notIn',
  ) as [string, ...string[]];
  const conditions = boundedArray(z.union([
    z.object({ measure, operator: z.enum(comparisons), value: number }).strict(),
    z.object({ measure, operator: z.literal('between'), value: z.array(number).min(2).max(2) }).strict(),
    z.object({ measure, operator: z.enum(['in', 'notIn']), value: z.array(number).min(1) }).strict(),
  ]), maximum);
  return conditions.describe(
    'Conditions on aggregated measure values, applied after grouping (SQL HAVING). '
    + 'Each condition must name a measure selected in this query.',
  );
}

function queryShape(
  catalog: DatasetCatalog,
  metricName: string | undefined,
  options: SemanticQuerySchemaOptions,
  relationshipOperators: ReadonlyMap<string, string[]>,
  localFilters: Readonly<Record<string, FilterPolicy>> = effectiveFilters(catalog),
  metric?: SemanticMetricQueryContract,
  localRelationshipFields: string[] = [],
): QueryShape {
  const limits = { ...DEFAULT_SEMANTIC_QUERY_SCHEMA_LIMITS, ...options };
  const relationshipFields = getQueryableRelationshipFields(catalog);
  const filterableRelationshipFields = [...relationshipOperators.keys()];
  const filterableRelationshipSet = new Set(filterableRelationshipFields);
  // `groupable: false` declares a dimension that exists to back a measure, not
  // to be selected. The agent-safe catalog already hides those, so the
  // generated schema must refuse them too — otherwise a dataset advertises one
  // set of dimensions and accepts another. This holds across a relationship
  // hop: a non-groupable target dimension stays filterable but is not a
  // grouping key, so the two lists are tracked separately.
  const groupableRelationshipFields = new Set(getGroupableRelationshipFields(catalog));
  const isGroupable = (name: string) => (
    catalog.dimensions[name] !== undefined
      ? catalog.dimensions[name].groupable !== false
      : groupableRelationshipFields.has(name)
  );
  const dimensions = metric
    ? uniqueSorted([
        ...metric.dimensions.filter(isGroupable),
        ...localRelationshipFields.filter(isGroupable),
      ])
    : uniqueSorted([
        ...Object.keys(catalog.dimensions).filter(isGroupable),
        ...relationshipFields.filter(isGroupable),
      ]);
  const localFilterNames = Object.keys(localFilters);
  const localFilterSet = new Set(localFilterNames);
  // A metric's own filter list stays authoritative: a hosted catalog may narrow it.
  const filterFields = metric
    ? uniqueSorted([
        ...metric.filters.filter(field => field.includes('.')
          ? filterableRelationshipSet.has(field)
          : localFilterSet.has(field)),
        ...localRelationshipFields.filter(field => filterableRelationshipSet.has(field)),
      ])
    : uniqueSorted([...localFilterNames, ...filterableRelationshipFields]);
  const grains = metric
    ? metric.grain ? [metric.grain] : metric.grains
    : catalog.supportedGrains;
  const orderable = metricName
    ? uniqueSorted([...dimensions, metricName, ...(grains.length > 0 ? ['period'] : [])])
    : uniqueSorted([
        ...dimensions,
        ...Object.keys(catalog.measures), ...getQueryableRelationshipMeasures(catalog),
        ...Object.keys(catalog.derivedMeasures ?? {}),
        ...(catalog.supportedGrains.length > 0 ? ['period'] : []),
      ]);
  const selectableMeasures = [
    ...Object.keys(catalog.measures),
    ...getQueryableRelationshipMeasures(catalog),
    ...Object.keys(catalog.derivedMeasures ?? {}),
  ];
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

  const calculations = !metricName && options.calculations === true;
  const maxFilters = lowerLimit(catalog.limits?.maxFilters, limits.maxFilters);
  const relativeDateFields = options.relativeDates
    ? relativeDateFilterFields(catalog, localFilters, filterFields)
    : [];
  const compact = options.filterGroups === true;
  const filterItem = filterItemSchema(
    filterLeafVariants(localFilters, filterFields, relationshipOperators, { compact, relativeDateFields }),
    { groups: options.filterGroups },
  );

  const shape: Record<string, ZodTypeAny> = {
    dimensions: boundedArray(
      fieldEnum(dimensions),
      lowerLimit(catalog.limits?.maxDimensions, limits.maxDimensions),
    ),
    ...(metricName ? {} : {
      measures: boundedArray(
        fieldEnum(selectableMeasures),
        lowerLimit(catalog.limits?.maxMeasures, limits.maxMeasures),
      ),
    }),
    filters: boundedArray(filterItem, maxFilters),
    // Opt-in, so existing schemas and manifest hashes are unchanged and a
    // surface only advertises conditions its executor can run.
    ...(!metricName && options.having ? {
      having: havingSchema(selectableMeasures, maxFilters, calculations),
    } : {}),
    // Only datasets that declare segments accept the field, so every other
    // schema, including hosted catalogs, is unchanged.
    ...(Object.keys(catalog.segments ?? {}).length > 0 ? {
      segments: boundedArray(fieldEnum(uniqueSorted(Object.keys(catalog.segments ?? {})))),
    } : {}),
    ...(calculations ? calculationShape({
      dimensions,
      hasTime: catalog.supportedGrains.length > 0,
      ...calculationMeasures(catalog),
      bucketDimensions: dimensions.filter(name => catalog.dimensions[name]?.type === 'string'),
      // A filter calculation conditions on local, non-time fields only: the
      // planner refuses every timestamp field, time axis or not.
      whereVariants: filterLeafVariants(
        localFilters,
        filterFields.filter(field => !field.includes('.')
          && !isTimeAxisFilter(catalog, localFilters, field)
          && !isTimestampFilter(catalog, localFilters, field)),
        relationshipOperators,
        { compact: true },
      ),
      maxCalculations: lowerLimit(catalog.limits?.maxMeasures, limits.maxMeasures),
    }) : {}),
    orderBy: boundedArray(z.object({
      // With calculations, an order may also name one of their outputs.
      field: calculations ? z.union([fieldEnum(orderable), referenceSchema()]) : fieldEnum(orderable),
      direction: z.enum(['asc', 'desc']),
    }).strict(), limits.maxOrderBy),
    limit: defaultResultSize === undefined
      ? limitSchema.optional()
      : limitSchema.default(defaultResultSize),
    offset: (limits.maxOffset === undefined
      ? z.number().int().nonnegative()
      : z.number().int().nonnegative().max(limits.maxOffset)).optional(),
    [grainField]: fieldEnum(grains).optional(),
    // Only datasets with more than one axis accept the field, so every other
    // schema and manifest hash is unchanged.
    ...(options.timeKey && grains.length > 0 && datasetTimeKeys(catalog).length > 1 ? {
      timeKey: fieldEnum(datasetTimeKeys(catalog)).optional().describe(
        `Time axis for the grain and time-based measures. Defaults to ${catalog.timeKey}.`,
      ),
    } : {}),
    timezone: z.string().max(100).refine(isQueryTimezone, 'Use an IANA timezone such as UTC or America/New_York.').optional(),
    // RFC 0029 puts `fill` after `timezone`. It needs a grain, so a dataset
    // without a time axis has no use for it.
    ...(!metricName && options.fill && catalog.supportedGrains.length > 0 ? {
      fill: z.boolean().optional().describe(
        'Return every grain period in the filtered time range, empty ones included. Needs grain and a time range filter.',
      ),
    } : {}),
    ...(options.includeMeta ? { includeMeta: z.boolean().optional() } : {}),
  };
  return calculations
    ? { shape, references: { orderable: new Set(orderable), measures: new Set(selectableMeasures) } }
    : { shape };
}

/** A query input's fields, and what a calculation output may stand in for. */
interface QueryShape {
  readonly shape: Record<string, ZodTypeAny>;
  /** Present when calculations are accepted: the published names `orderBy` and `having` may use. */
  readonly references?: { readonly orderable: ReadonlySet<string>; readonly measures: ReadonlySet<string> };
}

/**
 * The object schema for a query shape: strict, with the checks a shape cannot
 * express. A calculation output is named by the query, so that `orderBy` and
 * `having` only name outputs that exist is checked against the call.
 */
function queryObject(
  { shape, references }: QueryShape,
  selectors: Record<string, ZodTypeAny>,
  selectionRequired: boolean,
): ZodTypeAny {
  const object = z.object({ ...selectors, ...shape }).strict();
  const referenced = references === undefined ? object : object.superRefine((input, context) => {
    refineCalculationReferences(input as Parameters<typeof refineCalculationReferences>[0], references, context);
  });
  return selectionRequired ? requireSelection(referenced) : referenced;
}

export function buildDatasetInputSchema(
  dataset: SemanticQuerySchemaSource,
  options: SemanticQuerySchemaOptions = {},
): ZodTypeAny {
  return datasetInputSchema(dataset, options, {}, options.requireSelection !== false);
}

function datasetInputSchema(
  dataset: SemanticQuerySchemaSource,
  options: SemanticQuerySchemaOptions,
  selectors: Record<string, ZodTypeAny>,
  selectionRequired: boolean,
): ZodTypeAny {
  return queryObject(queryShape(
    resolveCatalog(dataset),
    undefined,
    options,
    relationshipFilterPolicy(dataset),
    localFilterPolicy(dataset),
  ), selectors, selectionRequired);
}

export function buildMetricInputSchema(
  dataset: SemanticQuerySchemaSource,
  metricName: string,
  options: SemanticQuerySchemaOptions = {},
  metricContract?: SemanticMetricQueryContract,
): ZodTypeAny {
  return metricInputSchema(dataset, metricName, options, metricContract, {});
}

function metricInputSchema(
  dataset: SemanticQuerySchemaSource,
  metricName: string,
  options: SemanticQuerySchemaOptions,
  metricContract: SemanticMetricQueryContract | undefined,
  selectors: Record<string, ZodTypeAny>,
): ZodTypeAny {
  const catalog = resolveCatalog(dataset);
  const metric = metricContract ?? catalog.metrics[metricName];
  const localRelationshipFields = isDatasetCatalog(dataset)
    ? []
    : getQueryableRelationshipFields(catalog);
  return queryObject(queryShape(
    catalog,
    metricName,
    options,
    relationshipFilterPolicy(dataset),
    localFilterPolicy(dataset),
    metric,
    localRelationshipFields,
  ), selectors, false);
}

function unionSchemas(schemas: ZodTypeAny[], emptyShape: Record<string, ZodTypeAny>): ZodTypeAny {
  if (schemas.length === 0) return z.object(emptyShape).strict();
  if (schemas.length === 1) return schemas[0];
  return z.union(schemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

function requireSelection(schema: ZodTypeAny): ZodTypeAny {
  return schema.refine(
    (input) => {
      const { dimensions, measures } = input as { dimensions?: unknown[]; measures?: unknown[] };
      return (dimensions?.length ?? 0) > 0 || (measures?.length ?? 0) > 0;
    },
    { message: 'At least one dimension or measure must be specified' },
  );
}

export function toSemanticJsonSchema(
  schema: AnyZodSchema,
  options: { requireSelection?: boolean } = {},
): JsonSchema {
  const { $schema: _schema, ...jsonSchema } = zodToDraft7JsonSchema(schema);
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

  const queryable = options.queryableDatasets === undefined
    ? undefined
    : new Set(options.queryableDatasets);

  for (const [datasetName, dataset] of Object.entries(datasets)
    .sort(([left], [right]) => compareStrings(left, right))) {
    if (queryable === undefined || queryable.has(datasetName)) {
      datasetSchemas.push(datasetInputSchema(
        dataset,
        options,
        { dataset: z.literal(datasetName) },
        options.requireSelection !== false,
      ));
    }
    const catalog = resolveCatalog(dataset);
    for (const metricName of Object.keys(catalog.metrics).sort(compareStrings)) {
      metricSchemas.push(metricInputSchema(
        dataset,
        metricName,
        options,
        catalog.metrics[metricName],
        { dataset: z.literal(datasetName), metric: z.literal(metricName) },
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

/**
 * The same input schema, as a `ProtocolSchema`.
 *
 * A hosted registry advertises one endpoint per dataset and per metric, and it
 * advertises them in the protocol's own schema format rather than Zod or JSON
 * Schema. Without this it has to rebuild the shape by hand — which is a second
 * generator of the knowledge `CORE-03` exists to keep in one place, and it
 * drifts silently: an advertised field the validator rejects, or a ceiling the
 * data plane does not apply.
 *
 * Derived from `buildDatasetInputSchema`, so there is one source for which
 * dimensions are groupable, which measures exist, what the filter operators
 * are, what the orderable fields are, which grains are supported, and what the
 * row ceiling is.
 */
export function buildDatasetInputProtocolSchema(
  dataset: SemanticQuerySchemaSource,
  options: SemanticQuerySchemaOptions = {},
  path = 'dataset.input',
): ProtocolSchema {
  assertProtocolSchemaOptions(options);
  return zodToProtocolSchema(buildDatasetInputSchema(dataset, options), path);
}

/**
 * RFC 0004 schemas have no self-reference and no string patterns, so filter
 * groups (which nest), relative ranges and calculations (which carry a
 * grammar) can't be described in one. Refused by name rather than converted
 * into a schema that accepts something else.
 */
function assertProtocolSchemaOptions(options: SemanticQuerySchemaOptions): void {
  const unsupported = (['filterGroups', 'relativeDates', 'calculations'] as const).filter(option => options[option]);
  if (unsupported.length > 0) {
    throw new Error(
      `Protocol query schemas cannot describe ${unsupported.join(', ')}: RFC 0004 has no recursive or pattern types. `
      + 'Build the protocol schema without them.',
    );
  }
}

/** The metric form of {@link buildDatasetInputProtocolSchema}. */
export function buildMetricInputProtocolSchema(
  dataset: SemanticQuerySchemaSource,
  metricName: string,
  options: SemanticQuerySchemaOptions = {},
  metricContract?: SemanticMetricQueryContract,
  path = 'metric.input',
): ProtocolSchema {
  assertProtocolSchemaOptions(options);
  return zodToProtocolSchema(
    buildMetricInputSchema(dataset, metricName, options, metricContract),
    path,
  );
}
