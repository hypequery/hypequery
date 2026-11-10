'use client';

import { useId, useState } from 'react';
import { useDataset } from '@/lib/analytics';
import type { DatasetFilter } from '@/lib/filters';

const W = 960;
const H = 240;
const PAD = { top: 12, right: 16, bottom: 28, left: 52 };
const formatInt = new Intl.NumberFormat('en-US');

/** Events and unique users per day, one SVG, two series, hover crosshair. */
export function Timeseries({ filters }: { filters: DatasetFilter[] }) {
  const { data, isPending, error } = useDataset('events', {
    by: 'day',
    measures: ['events', 'uniqueUsers'],
    filters,
    orderBy: [{ field: 'period', direction: 'asc' }],
  } as const);
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();

  const rows = data?.data ?? [];
  const points = rows.map((r) => ({
    day: String(r.period).slice(0, 10),
    events: Number(r.events),
    users: Number(r.uniqueUsers),
  }));
  const max = Math.max(1, ...points.map((p) => p.events));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const path = (key: 'events' | 'users') => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const hovered = hover === null ? null : points[hover];

  return (
    <section className="panel" aria-labelledby={titleId}>
      <h2 id={titleId}>Daily events and unique users</h2>
      <div className="legend" aria-hidden="true">
        <span><i className="swatch" style={{ background: 'var(--series-1)' }} />Events</span>
        <span><i className="swatch" style={{ background: 'var(--series-2)' }} />Unique users</span>
      </div>
      {error && <div className="state error">Could not load: {error.message}</div>}
      {!error && isPending && <div className="state">Loading…</div>}
      {!error && !isPending && points.length > 0 && (
        <svg
          className="chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Daily events and unique users, ${points[0].day} to ${points[points.length - 1].day}`}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const i = Math.round(((px - PAD.left) / innerW) * (points.length - 1));
            setHover(Math.max(0, Math.min(points.length - 1, i)));
          }}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">{formatInt.format(t)}</text>
            </g>
          ))}
          <text x={PAD.left} y={H - 8} fontSize="11" fill="var(--text-muted)">{points[0].day}</text>
          <text x={W - PAD.right} y={H - 8} fontSize="11" fill="var(--text-muted)" textAnchor="end">{points[points.length - 1].day}</text>
          <path d={path('events')} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" />
          <path d={path('users')} fill="none" stroke="var(--series-2)" strokeWidth="2" strokeLinejoin="round" />
          {hovered && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--text-muted)" strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(hovered.events)} r="4" fill="var(--series-1)" stroke="var(--panel)" strokeWidth="2" />
              <circle cx={x(hover)} cy={y(hovered.users)} r="4" fill="var(--series-2)" stroke="var(--panel)" strokeWidth="2" />
              <g transform={`translate(${Math.min(x(hover) + 10, W - 190)}, ${PAD.top})`}>
                <rect width="180" height="54" rx="6" fill="var(--panel)" stroke="var(--border)" />
                <text x="10" y="18" fontSize="12" fill="var(--text-secondary)">{hovered.day}</text>
                <text x="10" y="34" fontSize="12" fill="var(--text)">Events: {formatInt.format(hovered.events)}</text>
                <text x="10" y="48" fontSize="12" fill="var(--text)">Unique users: {formatInt.format(hovered.users)}</text>
              </g>
            </g>
          )}
        </svg>
      )}
      <div className="sr-only">
        <table>
          <caption>Daily events and unique users</caption>
          <thead><tr><th>Day</th><th>Events</th><th>Unique users</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.day}><td>{p.day}</td><td>{p.events}</td><td>{p.users}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
