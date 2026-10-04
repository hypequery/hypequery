import { describe, expect, it } from 'vitest';
import type { SemanticMetadata } from '../types.js';
import { dataset } from '../dataset.js';
import { dimension } from '../field.js';
import { validateSemanticMetadata } from './semantic-metadata-validation.js';

describe('semantic metadata bounds', () => {
  it.each([
    [{ format: 1 }, 'must be a string'], [{ unit: '   ' }, 'must not be empty'],
    [{ format: '€'.repeat(1366) }, 'UTF-8 bytes'],
    [{ examples: Array.from({ length: 101 }, (_, i) => String(i)) }, 'at most 100'],
    [{ examples: ['same', 'same'] }, 'duplicates'], [{ synonyms: [1] }, 'must be a string'],
    [{ currency: 'usd' }, 'uppercase currency'], [{ sensitivity: 'unknown' }, 'sensitivity'],
  ])('rejects invalid metadata %j', (metadata, error) => {
    expect(() => validateSemanticMetadata('sales', 'metadata', metadata as SemanticMetadata)).toThrow(error);
  });

  it.each([
    [{ owner: '' }, 'must not be empty'],
    [{ freshness: { maxAgeSeconds: 0 } }, 'positive safe integer'],
    [{ defaults: null }, 'must be an object'],
    [{ defaults: { dimensions: 'amount' } }, 'must be an array'],
    [{ defaults: { dimensions: Array(101).fill('amount') } }, 'at most 100'],
    [{ defaults: { dimensions: ['amount', 'amount'] } }, 'duplicates'],
    [{ defaults: { dimensions: ['missing'] } }, 'non-groupable'],
    [{ defaults: {} }, 'dimensions or timeGrain'],
    [{ defaults: { timeGrain: 'hour' } }, 'requires the dataset to define timeKey'],
    [{ timeKey: 'time', defaults: { timeGrain: 'invalid' } }, 'supported time grain'],
    [{ timeKey: 'time', timeGrains: ['day'], defaults: { timeGrain: 'hour' } }, 'not one of'],
    [{ timeGrains: [] }, 'non-empty array'],
    [{ timeGrains: ['day'] }, 'requires the dataset to define timeKey'],
    [{ timeKey: 'time', timeGrains: ['day', 'day'] }, 'duplicates'],
    [{ timeKey: 'time', timeGrains: ['invalid'] }, 'unsupported time grain'],
  ])('rejects invalid dataset defaults %j', (config, error) => {
    expect(() => dataset('sales', {
      source: 'sales', dimensions: { amount: dimension.number(), time: dimension.timestamp() },
      ...config,
    } as Parameters<typeof dataset>[1])).toThrow(error);
  });
});
