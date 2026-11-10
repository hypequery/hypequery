'use client';

import { useDataset } from '@/lib/analytics';
import type { DatasetFilter } from '@/lib/filters';

const formatInt = new Intl.NumberFormat('en-US');
const formatPct = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 });

export function KpiTiles({ filters }: { filters: DatasetFilter[] }) {
  const { data, isPending, error } = useDataset('events', {
    measures: ['events', 'uniqueUsers', 'errorRate', 'p95LatencyMs'],
    filters,
  } as const);
  const row = data?.data[0];
  const value = (render: (r: NonNullable<typeof row>) => string) =>
    error ? 'error' : isPending || !row ? '…' : render(row);

  return (
    <>
      <Tile label="Events" value={value((r) => formatInt.format(Number(r.events)))} />
      <Tile label="Unique users" value={value((r) => formatInt.format(Number(r.uniqueUsers)))} />
      <Tile label="Error rate" value={value((r) => formatPct.format(Number(r.errorRate ?? 0)))} sub="5xx responses" />
      <Tile label="p95 latency" value={value((r) => `${Math.round(Number(r.p95LatencyMs))} ms`)} />
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <section className="panel third tile" aria-label={label}>
      <h2>{label}</h2>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </section>
  );
}
