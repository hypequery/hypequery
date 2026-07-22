import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, Plus, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import { track } from '@/lib/telemetry';
import {
  datasetLabel,
  isDatasetEntry,
  parseDatasetQueryShape,
} from '@/lib/semantic-schema';
import { useRegistry } from '@/hooks/useRegistry';
import { EmptyState } from './EmptyState';
import { SQLViewer } from './SQLViewer';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Badge } from './ui/badge';

interface FilterRow {
  id: number;
  field: string;
  operator: string;
  value: string;
}

interface PlaygroundProps {
  className?: string;
}

let nextFilterId = 1;

/**
 * Interactive query playground: pick a dataset, choose dimensions and
 * measures, add filters, and run the query through the real serve pipeline
 * via POST /execute. Completed runs also stream into the Runs screen over
 * SSE — this screen shows the immediate result.
 */
export function Playground({ className }: PlaygroundProps) {
  const { endpoints, loading: registryLoading, error: registryError } = useRegistry();
  const datasets = useMemo(() => endpoints.filter(isDatasetEntry), [endpoints]);

  const [datasetKey, setDatasetKey] = useState<string>('');
  const [dimensions, setDimensions] = useState<string[]>([]);
  const [measures, setMeasures] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [limit, setLimit] = useState<string>('100');

  const selected = datasets.find((d) => d.key === datasetKey) ?? datasets[0];
  const shape = useMemo(
    () => (selected ? parseDatasetQueryShape(selected) : null),
    [selected]
  );

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('No dataset selected');
      const input: Record<string, unknown> = {};
      if (dimensions.length) input.dimensions = dimensions;
      if (measures.length) input.measures = measures;
      const activeFilters = filters.filter((f) => f.field && f.operator);
      if (activeFilters.length) {
        input.filters = activeFilters.map((f) => ({
          field: f.field,
          operator: f.operator,
          value: parseFilterValue(f.value, f.operator),
        }));
      }
      const parsedLimit = Number(limit);
      if (Number.isFinite(parsedLimit) && parsedLimit > 0) input.limit = parsedLimit;

      track('execute_clicked', undefined, { once: true });
      return apiClient.execute(selected.key, input);
    },
  });

  const selectDataset = (key: string) => {
    setDatasetKey(key);
    // Field lists differ per dataset; stale selections would fail validation.
    setDimensions([]);
    setMeasures([]);
    setFilters([]);
    runMutation.reset();
  };

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  if (registryError) {
    return (
      <div className={cn('p-4 text-center text-destructive', className)}>
        Failed to load registry: {registryError.message}
      </div>
    );
  }

  if (!registryLoading && datasets.length === 0) {
    return (
      <EmptyState
        type="no-results"
        title="No datasets registered"
        description="Register datasets on your serve API to query them here. Plain queries and metrics appear in Runs when executed."
        className={cn('h-full', className)}
      />
    );
  }

  return (
    <div className={cn('flex h-full min-w-0', className)}>
      {/* Query builder rail */}
      <div className="flex w-[320px] flex-shrink-0 flex-col gap-5 overflow-auto border-r border-border bg-card/45 p-4">
        <section>
          <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Dataset
          </label>
          <Select
            value={selected?.key ?? ''}
            onChange={(e) => selectDataset(e.target.value)}
          >
            {datasets.map((d) => (
              <option key={d.key} value={d.key}>
                {datasetLabel(d)}
              </option>
            ))}
          </Select>
          {selected?.description && (
            <p className="mt-1.5 text-xs text-muted-foreground">{selected.description}</p>
          )}
        </section>

        <CheckboxGroup
          label="Dimensions"
          options={shape?.dimensions ?? []}
          selected={dimensions}
          onToggle={(v) => toggle(dimensions, setDimensions, v)}
        />

        <CheckboxGroup
          label="Measures"
          options={shape?.measures ?? []}
          selected={measures}
          onToggle={(v) => toggle(measures, setMeasures, v)}
        />

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Filters
            </label>
            <Button
              variant="outline"
              size="sm"
              aria-label="Add filter"
              onClick={() =>
                setFilters([
                  ...filters,
                  {
                    id: nextFilterId++,
                    field: shape?.filterFields[0] ?? '',
                    operator: shape?.operators[0] ?? 'eq',
                    value: '',
                  },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {filters.map((filter) => (
              <div key={filter.id} className="flex items-center gap-1.5">
                <Select
                  className="min-w-0 flex-1"
                  value={filter.field}
                  onChange={(e) => updateFilter(setFilters, filter.id, { field: e.target.value })}
                >
                  {(shape?.filterFields ?? []).map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
                <Select
                  className="w-[86px] flex-shrink-0"
                  value={filter.operator}
                  onChange={(e) =>
                    updateFilter(setFilters, filter.id, { operator: e.target.value })
                  }
                >
                  {(shape?.operators ?? []).map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </Select>
                <Input
                  className="min-w-0 flex-1"
                  placeholder={filter.operator === 'in' || filter.operator === 'notIn' ? 'a, b, c' : 'value'}
                  value={filter.value}
                  onChange={(e) => updateFilter(setFilters, filter.id, { value: e.target.value })}
                />
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Remove filter"
                  onClick={() => setFilters(filters.filter((f) => f.id !== filter.id))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {filters.length === 0 && (
              <p className="text-xs text-muted-foreground">No filters.</p>
            )}
          </div>
        </section>

        <section>
          <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Limit
          </label>
          <Input
            type="number"
            min={1}
            {...(shape?.maxLimit != null ? { max: shape.maxLimit } : {})}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </section>

        <Button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending || !selected || (dimensions.length === 0 && measures.length === 0)}
        >
          {runMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run query
        </Button>
      </div>

      {/* Results */}
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <PlaygroundResult
          pending={runMutation.isPending}
          error={runMutation.error}
          result={runMutation.data}
        />
      </div>
    </div>
  );
}

function updateFilter(
  setFilters: React.Dispatch<React.SetStateAction<FilterRow[]>>,
  id: number,
  patch: Partial<FilterRow>
) {
  setFilters((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
}

/** `in`/`notIn` take comma-separated lists; numbers pass through typed. */
function parseFilterValue(raw: string, operator: string): unknown {
  const coerce = (v: string): unknown => {
    const trimmed = v.trim();
    if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    return trimmed;
  };
  if (operator === 'in' || operator === 'notIn') {
    return raw.split(',').map(coerce);
  }
  return coerce(raw);
}

function CheckboxGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <section>
      <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </label>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">None declared.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onToggle(option)}
              className={cn(
                'rounded-md border px-2 py-1 font-mono text-xs transition-colors',
                selected.includes(option)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              )}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Rows live under `data`/`rows`, or the result itself is an array. */
function extractRows(result: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === 'object') {
    const container = result as { data?: unknown; rows?: unknown };
    if (Array.isArray(container.data)) return container.data as Array<Record<string, unknown>>;
    if (Array.isArray(container.rows)) return container.rows as Array<Record<string, unknown>>;
  }
  return null;
}

function extractSql(result: unknown): string | null {
  if (result && typeof result === 'object') {
    const container = result as { sql?: unknown; meta?: { sql?: unknown } };
    if (typeof container.sql === 'string') return container.sql;
    if (typeof container.meta?.sql === 'string') return container.meta.sql;
  }
  return null;
}

function unionColumns(rows: Array<Record<string, unknown>>): string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === 'object') {
      for (const key of Object.keys(row)) columns.add(key);
    }
  }
  return Array.from(columns);
}

function formatCell(value: unknown): string {
  if (value == null) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function PlaygroundResult({
  pending,
  error,
  result,
}: {
  pending: boolean;
  error: Error | null;
  result?: Awaited<ReturnType<typeof apiClient.execute>>;
}) {
  if (pending) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
        <p className="font-mono text-sm text-destructive">{error.message}</p>
      </div>
    );
  }

  if (!result) {
    return (
      <EmptyState
        type="no-results"
        title="Run a query"
        description="Pick dimensions and measures on the left, then run the query through your API's real pipeline."
        className="h-full"
      />
    );
  }

  if (!result.success) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
        <p className="font-mono text-sm text-destructive">
          {result.error?.message ?? 'Query failed'}
        </p>
      </div>
    );
  }

  const rows = extractRows(result.result);
  const sql = extractSql(result.result);
  const columns = rows ? unionColumns(rows) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{result.durationMs}ms</Badge>
        {rows && <Badge variant="secondary">{rows.length} rows</Badge>}
      </div>

      {rows && rows.length > 0 ? (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/45">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {columns.map((column) => (
                    <td key={column} className="px-3 py-2 font-mono text-xs">
                      {formatCell(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : rows ? (
        <p className="text-sm text-muted-foreground">Query returned no rows.</p>
      ) : (
        <pre className="overflow-auto rounded-md border border-border bg-muted/45 p-3 font-mono text-xs">
          {JSON.stringify(result.result, null, 2)}
        </pre>
      )}

      {sql && <SQLViewer sql={sql} />}
    </div>
  );
}

export default Playground;
