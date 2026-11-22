import type { DatasetEvents, DimensionDefinition } from '../types.js';

interface EventDatasetShape {
  readonly timeKey?: string;
  readonly dimensions: Readonly<Record<string, DimensionDefinition>>;
  readonly events?: DatasetEvents;
}

/**
 * RFC 0027: `entity` names who acted and must be a groupable string or number
 * dimension; `event` optionally names what happened and must be a filterable
 * string dimension; the event timestamp is the dataset's timestamp `timeKey`.
 * The deployment contract applies the same rules, so a dataset that defines
 * also publishes.
 */
export function datasetEventsErrors(config: EventDatasetShape): string[] {
  const { events } = config;
  if (events === undefined) return [];
  if (typeof events !== 'object' || events === null || Array.isArray(events)) {
    return ['events must be an object with an entity dimension.'];
  }
  const errors: string[] = [];
  for (const key of Object.keys(events)) {
    if (key !== 'entity' && key !== 'event') errors.push(`events.${key} is not supported; use entity and event.`);
  }
  const entity = config.dimensions[events.entity as string];
  if (typeof events.entity !== 'string' || !Object.hasOwn(config.dimensions, events.entity) || !entity) {
    errors.push(`events.entity "${String(events.entity)}" must name a dimension.`);
  } else if (entity.groupable === false || (entity.fieldType !== 'string' && entity.fieldType !== 'number')) {
    errors.push(`events.entity "${events.entity}" must be a groupable string or number dimension.`);
  }
  if (events.event !== undefined) {
    const event = config.dimensions[events.event];
    if (typeof events.event !== 'string' || !Object.hasOwn(config.dimensions, events.event) || !event) {
      errors.push(`events.event "${String(events.event)}" must name a dimension.`);
    } else if (event.filterable === false || event.fieldType !== 'string') {
      errors.push(`events.event "${events.event}" must be a filterable string dimension.`);
    }
  }
  const timeKey = config.timeKey;
  if (timeKey === undefined || config.dimensions[timeKey]?.fieldType !== 'timestamp') {
    errors.push('events requires a timeKey naming a timestamp dimension: the event timestamp.');
  }
  return errors;
}

export function snapshotDatasetEvents(events: DatasetEvents | undefined): { events?: DatasetEvents } {
  if (events === undefined) return {};
  return { events: Object.freeze({ entity: events.entity, ...(events.event === undefined ? {} : { event: events.event }) }) };
}
