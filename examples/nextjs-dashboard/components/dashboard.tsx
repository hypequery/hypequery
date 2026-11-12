'use client';

import { useState } from 'react';
import { BreakdownBars } from './breakdown-bars';
import { KpiTiles } from './kpi-tiles';
import { Timeseries } from './timeseries';
import {
  clearSelections,
  initialState,
  RANGE_PRESETS,
  rangeEndingAt,
  SEED_LAST_DAY,
  toDatasetFilters,
  toggleSelection,
  type CrossFilterState,
  type Dimension,
} from '@/lib/filters';

/**
 * The dashboard owns one piece of state: the date range plus the current
 * selections. Every panel derives its own dataset filters from it, so a click
 * in one panel re-queries all the others through the same `events` endpoint.
 */
export function Dashboard() {
  const [state, setState] = useState<CrossFilterState>(initialState);
  const select = (dimension: Dimension, value: string) =>
    setState((current) => toggleSelection(current, dimension, value));
  const activeDays = Math.round(
    (Date.parse(`${state.range.to}T00:00:00Z`) - Date.parse(`${state.range.from}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  const selections = Object.entries(state.selections) as Array<[Dimension, string]>;

  return (
    <>
      <div className="toolbar" role="toolbar" aria-label="Filters">
        {RANGE_PRESETS.map((preset) => (
          <button
            key={preset.days}
            type="button"
            className="chip"
            aria-pressed={activeDays === preset.days}
            onClick={() => setState((current) => ({ ...current, range: rangeEndingAt(SEED_LAST_DAY, preset.days) }))}
          >
            Last {preset.label}
          </button>
        ))}
        <span className="spacer" />
        {selections.map(([dimension, value]) => (
          <button key={dimension} type="button" className="chip selection" onClick={() => select(dimension, value)}>
            {dimension}: {value} ×
          </button>
        ))}
        {selections.length > 0 && (
          <button type="button" className="chip" onClick={() => setState(clearSelections)}>
            Clear all
          </button>
        )}
      </div>

      <div className="grid">
        <KpiTiles filters={toDatasetFilters(state)} />
        <Timeseries filters={toDatasetFilters(state)} />
        <BreakdownBars
          title="Events by type"
          dimension="eventType"
          filters={toDatasetFilters(state, 'eventType')}
          selected={state.selections.eventType}
          onSelect={(value) => select('eventType', value)}
        />
        <BreakdownBars
          title="Events by device"
          dimension="device"
          filters={toDatasetFilters(state, 'device')}
          selected={state.selections.device}
          onSelect={(value) => select('device', value)}
        />
      </div>
    </>
  );
}
