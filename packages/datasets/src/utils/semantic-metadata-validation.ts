import type {
  DatasetConfig,
  DimensionDefinition,
  MeasureDefinition,
  RelationshipDefinition,
  SemanticMetadata,
} from '../types.js';

const MAX_METADATA_ITEMS = 100;
const MAX_METADATA_TEXT_BYTES = 4_096;
const SENSITIVITIES = new Set(['public', 'internal', 'confidential', 'restricted']);
const TIME_GRAINS = new Set(['day', 'week', 'month', 'quarter', 'year']);
const textEncoder = new TextEncoder();

function fail(datasetName: string, location: string, message: string): never {
  throw new Error(`Invalid dataset "${datasetName}": ${location} ${message}`);
}

function validateText(datasetName: string, location: string, value: unknown): asserts value is string {
  if (typeof value !== 'string') fail(datasetName, location, 'must be a string.');
  if (value.trim().length === 0) fail(datasetName, location, 'must not be empty.');
  if (textEncoder.encode(value).byteLength > MAX_METADATA_TEXT_BYTES) {
    fail(datasetName, location, `must not exceed ${MAX_METADATA_TEXT_BYTES} UTF-8 bytes.`);
  }
}

export function validateSemanticMetadata(
  datasetName: string,
  location: string,
  metadata: SemanticMetadata,
): void {
  for (const key of ['examples', 'synonyms'] as const) {
    const values = metadata[key];
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.length > MAX_METADATA_ITEMS) {
      fail(datasetName, `${location}.${key}`, `must contain at most ${MAX_METADATA_ITEMS} strings.`);
    }
    if (new Set(values).size !== values.length) {
      fail(datasetName, `${location}.${key}`, 'must not contain duplicates.');
    }
    for (const [index, value] of values.entries()) {
      if (typeof value !== 'string') {
        fail(datasetName, `${location}.${key}[${index}]`, 'must be a string.');
      }
      validateText(datasetName, `${location}.${key}[${index}]`, value);
    }
  }
  for (const key of ['format', 'unit', 'timezone'] as const) {
    const value = metadata[key];
    if (value !== undefined) validateText(datasetName, `${location}.${key}`, value);
  }
  if (metadata.currency !== undefined) {
    if (typeof metadata.currency !== 'string' || !/^[A-Z]{3}$/.test(metadata.currency)) {
      fail(datasetName, `${location}.currency`, 'must be a three-letter uppercase currency code.');
    }
  }
  if (metadata.sensitivity !== undefined
    && (typeof metadata.sensitivity !== 'string' || !SENSITIVITIES.has(metadata.sensitivity))) {
    fail(datasetName, `${location}.sensitivity`, 'is not a supported sensitivity classification.');
  }
}

export function validateDatasetAgentMetadata<
  TDimensions extends Record<string, DimensionDefinition>,
  TMeasures extends Record<string, MeasureDefinition>,
  TRelationships extends Record<string, RelationshipDefinition>,
>(
  datasetName: string,
  config: DatasetConfig<TDimensions, TMeasures, TRelationships>,
): void {
  validateSemanticMetadata(datasetName, 'metadata', config);
  if (config.description !== undefined) validateText(datasetName, 'description', config.description);
  if (config.owner !== undefined) validateText(datasetName, 'owner', config.owner);
  if (config.freshness !== undefined) {
    if (typeof config.freshness !== 'object' || config.freshness === null
      || !Number.isSafeInteger(config.freshness.maxAgeSeconds)
      || config.freshness.maxAgeSeconds < 1) {
      fail(datasetName, 'freshness.maxAgeSeconds', 'must be a positive safe integer.');
    }
  }
  if (config.defaults !== undefined) {
    if (typeof config.defaults !== 'object' || config.defaults === null) {
      fail(datasetName, 'defaults', 'must be an object.');
    }
    if (config.defaults.dimensions !== undefined && !Array.isArray(config.defaults.dimensions)) {
      fail(datasetName, 'defaults.dimensions', 'must be an array.');
    }
    const dimensions = config.defaults.dimensions ?? [];
    if (dimensions.length > MAX_METADATA_ITEMS) {
      fail(
        datasetName,
        'defaults.dimensions',
        `must contain at most ${MAX_METADATA_ITEMS} dimensions.`,
      );
    }
    if (new Set(dimensions).size !== dimensions.length) {
      fail(datasetName, 'defaults.dimensions', 'must not contain duplicates.');
    }
    for (const dimension of dimensions) {
      const definition = config.dimensions[dimension];
      if (!definition || definition.groupable === false) {
        fail(datasetName, 'defaults.dimensions', `references non-groupable dimension "${dimension}".`);
      }
    }
    if (config.defaults.timeGrain !== undefined && config.timeKey === undefined) {
      fail(datasetName, 'defaults.timeGrain', 'requires the dataset to define timeKey.');
    }
    if (config.defaults.timeGrain !== undefined && !TIME_GRAINS.has(config.defaults.timeGrain)) {
      fail(datasetName, 'defaults.timeGrain', 'is not a supported time grain.');
    }
    if (dimensions.length === 0 && config.defaults.timeGrain === undefined) {
      fail(datasetName, 'defaults', 'must define dimensions or timeGrain.');
    }
  }

  for (const [name, dimension] of Object.entries(config.dimensions)) {
    validateSemanticMetadata(datasetName, `dimensions.${name}`, dimension);
  }
  for (const [name, measure] of Object.entries(config.measures ?? {})) {
    validateSemanticMetadata(datasetName, `measures.${name}`, measure);
  }
  for (const [name, filter] of Object.entries(config.filters ?? {})) {
    validateSemanticMetadata(datasetName, `filters.${name}`, filter);
  }
}
