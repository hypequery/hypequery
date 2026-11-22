import { parseProtocolIdentifier } from '../identifiers/index.js';
import { deploymentError } from './errors.js';
import type { ProtocolIdentifier, ProtocolQualifiedIdentifier } from '../identifiers/index.js';
import type { ProtocolDatasetDimension, ProtocolDatasetEvents } from './types.js';

function simpleIdentifier(value: unknown, path: string): ProtocolIdentifier {
  try {
    return parseProtocolIdentifier(value);
  } catch {
    return deploymentError('HQ_DEPLOYMENT_INVALID_IDENTIFIER', path);
  }
}

/**
 * RFC 0027: an event dataset names the dimension that identifies who acted
 * (`entity`) and, optionally, the one naming what happened (`event`). The
 * event timestamp is always the dataset's `timeField`, so the declaration is
 * checked against the dataset's own dimensions and time field.
 */
export function validateProtocolDatasetEvents(
  input: unknown,
  path: string,
  dimensions: readonly ProtocolDatasetDimension[],
  timeField: ProtocolQualifiedIdentifier | undefined,
): ProtocolDatasetEvents {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) deploymentError('HQ_DEPLOYMENT_TYPE', path);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
  const value = input as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', path);
    }
    if (key !== 'entity' && key !== 'event') deploymentError('HQ_DEPLOYMENT_UNKNOWN_FIELD', `${path}.${key}`);
  }
  if (!Object.hasOwn(value, 'entity')) deploymentError('HQ_DEPLOYMENT_TYPE', `${path}.entity`);
  const entity = simpleIdentifier(value.entity, `${path}.entity`);
  const event = value.event === undefined ? undefined : simpleIdentifier(value.event, `${path}.event`);

  const byName = new Map(dimensions.map(dimension => [String(dimension.name), dimension]));
  const entityDimension = byName.get(entity);
  if (!entityDimension) deploymentError('HQ_DEPLOYMENT_INVALID_REFERENCE', `${path}.entity`);
  // Distinct entities are counted per group, so the entity must be a value a
  // caller could group by, and not a point in time.
  if (!entityDimension.groupable || (entityDimension.type !== 'string' && entityDimension.type !== 'number')) {
    deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.entity`);
  }
  if (event !== undefined) {
    const eventDimension = byName.get(event);
    if (!eventDimension) deploymentError('HQ_DEPLOYMENT_INVALID_REFERENCE', `${path}.event`);
    if (!eventDimension.filterable || eventDimension.type !== 'string') {
      deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}.event`);
    }
  }
  // The time field is the event timestamp: it must be one of this dataset's
  // own timestamp dimensions.
  const time = timeField === undefined ? undefined : byName.get(String(timeField));
  if (time === undefined || time.type !== 'timestamp') deploymentError('HQ_DEPLOYMENT_INVALID_REFERENCE', path);
  return Object.freeze({ entity, ...(event === undefined ? {} : { event }) }) as ProtocolDatasetEvents;
}
