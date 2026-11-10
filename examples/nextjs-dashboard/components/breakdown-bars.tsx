'use client';

import { useDataset } from '@/lib/analytics';
import type { DatasetFilter, Dimension } from '@/lib/filters';

const formatInt = new Intl.NumberFormat('en-US');

interface Props {
  title: string;
  dimension: Dimension;
  filters: DatasetFilter[];
  selected?: string;
  onSelect: (value: string) => void;
}

/** Horizontal bars; each row is a button that toggles a cross-filter. */
export function BreakdownBars({ title, dimension, filters, selected, onSelect }: Props) {
  const { data, isPending, error } = useDataset('events', {
    dimensions: [dimension],
    measures: ['events'],
    filters,
    orderBy: [{ field: 'events', direction: 'desc' }],
    limit: 8,
  } as const);

  const rows = data?.data ?? [];
  const max = Math.max(1, ...rows.map((r) => Number(r.events)));

  return (
    <section className="panel half" aria-label={title}>
      <h2>{title}</h2>
      {error && <div className="state error">Could not load: {error.message}</div>}
      {!error && isPending && <div className="state">Loading…</div>}
      {!error && !isPending && (
        <div className="bars" role="group" aria-label={`${title}, click a bar to filter`}>
          {rows.map((row) => {
            const label = String(row[dimension]);
            const count = Number(row.events);
            const pressed = selected === label;
            return (
              <button
                key={label}
                type="button"
                className={`bar-row${selected && !pressed ? ' dimmed' : ''}`}
                aria-pressed={pressed}
                onClick={() => onSelect(label)}
                title={`${label}: ${formatInt.format(count)} events`}
              >
                <span className="label">{label}</span>
                <span className="track"><span className="fill" style={{ width: `${(count / max) * 100}%` }} /></span>
                <span className="num">{formatInt.format(count)}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
