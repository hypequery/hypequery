import type { MeasureTimeInterval, TimeGrain, WindowMeasureDefinition, ShiftMeasureDefinition } from '../types.js';

/** Additive metadata shared by local catalogs and their agent-safe projection. */
export interface WindowCatalogMetadata {
  kind?: 'window' | 'shift';
  interval?: MeasureTimeInterval;
  measure?: string;
  trailing?: MeasureTimeInterval;
  toDate?: Exclude<TimeGrain, 'minute'>;
  cumulative?: true;
  requiresTimeRange?: true;
  supportedGrains?: TimeGrain[];
}

export function windowCatalogMetadata(definition: WindowMeasureDefinition | ShiftMeasureDefinition | WindowCatalogMetadata): WindowCatalogMetadata {
  const grains = 'supportedGrains' in definition && definition.supportedGrains
    ? { supportedGrains: [...definition.supportedGrains] } : {};
  if ('interval' in definition && definition.interval) {
    return { ...grains, kind: 'shift', measure: definition.measure, interval: { ...definition.interval }, requiresTimeRange: true };
  }
  if ('__type' in definition || definition.kind === 'window') {
    return {
      ...grains,
      kind: 'window', measure: definition.measure, requiresTimeRange: true,
      ...('trailing' in definition && definition.trailing ? { trailing: { ...definition.trailing } } : {}),
      ...('toDate' in definition && definition.toDate ? { toDate: definition.toDate } : {}),
      ...('cumulative' in definition && definition.cumulative ? { cumulative: true } : {}),
    };
  }
  return definition.requiresTimeRange ? { ...grains, requiresTimeRange: true } : grains;
}
