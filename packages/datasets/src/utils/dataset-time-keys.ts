/**
 * Multiple time axes per dataset (HQ-80).
 *
 * `timeKey` is a dataset's default time axis; `timeKeys` names the other axes
 * a query may select with `query.timeKey`, such as `shipped_at` beside
 * `created_at`. A query on another axis compiles against a view of the dataset
 * whose `timeKey` is that axis, so grains, windows, shifts and time-range
 * checks follow the selection without each of them knowing about it.
 */

interface TimeAxes {
  readonly name?: string;
  readonly timeKey?: string;
  readonly timeKeys?: readonly string[];
}

/** Every time axis a query may select, the default first; empty without a `timeKey`. */
export function datasetTimeKeys(dataset: TimeAxes): string[] {
  if (!dataset.timeKey) return [];
  return [dataset.timeKey, ...(dataset.timeKeys ?? []).filter(key => key !== dataset.timeKey)];
}

/** The validation message for a query's `timeKey` selection, or undefined. */
export function selectedTimeKeyError(dataset: TimeAxes, timeKey: unknown): string | undefined {
  if (timeKey === undefined) return undefined;
  if (typeof timeKey !== 'string') return 'Invalid timeKey: expected a string.';
  const keys = datasetTimeKeys(dataset);
  if (keys.length === 0) {
    return `Cannot select timeKey "${timeKey}" — dataset "${dataset.name}" has no timeKey.`;
  }
  if (!keys.includes(timeKey)) {
    return `Unknown timeKey "${timeKey}" on dataset "${dataset.name}". Available: ${keys.join(', ')}`;
  }
  return undefined;
}

/**
 * True when a query selects an axis other than the dataset's default. Naming
 * the default explicitly is the same query as omitting it.
 */
export function selectsAlternateTimeKey(dataset: TimeAxes, timeKey: string | undefined): timeKey is string {
  return timeKey !== undefined && timeKey !== dataset.timeKey;
}

/**
 * The dataset as seen by a query on `timeKey`: the selected axis becomes
 * `timeKey` and the rest stay declared, so the view is itself a valid dataset
 * and rebasing it again is a no-op. Throws for an axis the dataset does not
 * declare; validate first to report it as a query error.
 */
export function datasetOnTimeKey<TDataset extends TimeAxes>(dataset: TDataset, timeKey: string | undefined): TDataset {
  if (!selectsAlternateTimeKey(dataset, timeKey)) return dataset;
  const error = selectedTimeKeyError(dataset, timeKey);
  if (error) throw new Error(error);
  return {
    ...dataset,
    timeKey,
    timeKeys: Object.freeze(datasetTimeKeys(dataset).filter(key => key !== timeKey)),
  };
}
