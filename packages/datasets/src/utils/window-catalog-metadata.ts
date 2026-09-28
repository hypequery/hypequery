import type { MeasureTimeInterval, TimeGrain, WindowMeasureDefinition } from '../types.js';

/** Additive metadata shared by local catalogs and their agent-safe projection. */
export interface WindowCatalogMetadata {
  kind?: 'window';
  measure?: string;
  trailing?: MeasureTimeInterval;
  toDate?: Exclude<TimeGrain, 'minute'>;
  cumulative?: true;
  requiresTimeRange?: true;
}

export function windowCatalogMetadata(definition: WindowMeasureDefinition | WindowCatalogMetadata): WindowCatalogMetadata {
  if ('__type' in definition || definition.kind === 'window') {
    return {
      kind: 'window', measure: definition.measure, requiresTimeRange: true,
      ...(definition.trailing ? { trailing: { ...definition.trailing } } : {}),
      ...(definition.toDate ? { toDate: definition.toDate } : {}),
      ...(definition.cumulative ? { cumulative: true } : {}),
    };
  }
  return definition.requiresTimeRange ? { requiresTimeRange: true } : {};
}
