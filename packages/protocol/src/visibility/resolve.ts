import type { ProtocolDeploymentDataset } from '../deployments/index.js';
import type {
  ProtocolFieldVisibility,
  ProtocolVisibleDatasetFields,
  ProtocolVisibleFields,
} from './types.js';

function pick(all: readonly string[], allowed: ProtocolVisibleFields): Set<string> {
  if (allowed === '*') return new Set(all);
  const permitted = new Set(allowed);
  return new Set(all.filter(name => permitted.has(name)));
}

/** The measures a measure is computed from: a derived measure's inputs, or the one a time measure wraps. */
function measureInputs(measure: object): readonly string[] {
  if ('uses' in measure && Array.isArray(measure.uses)) {
    return measure.uses.map((use: { measure: unknown }) => String(use.measure));
  }
  if ('measure' in measure && typeof measure.measure === 'string') return [measure.measure];
  return [];
}

/** A measure over the dataset's time axis (window or shift), which needs the time field. */
function isTimeMeasure(measure: object): boolean {
  return 'measure' in measure && typeof measure.measure === 'string';
}

/**
 * What one dataset exposes under a visibility policy, or null when the policy
 * hides the dataset (RFC 0018).
 *
 * Names the policy lists but the contract doesn't have are ignored, so a
 * policy written against one release keeps working after a later release
 * removes a field. Visibility only narrows: a dimension the contract marks
 * non-groupable or non-filterable stays so.
 *
 * - A one-hop `relationship.dimension` is visible only when the target dataset
 *   and that dimension are visible in the target's own entry.
 * - A declared filter is visible only when the dimension it filters is.
 * - The time field is visible only as a visible dimension; grouping by period
 *   and time measures need it.
 * - A measure is visible only when it is listed and every measure it is
 *   computed from is visible too. A derived ratio over a hidden measure would
 *   let a caller recover the hidden value.
 */
export function resolveProtocolVisibleDatasetFields(
  dataset: ProtocolDeploymentDataset,
  datasets: ReadonlyMap<string, ProtocolDeploymentDataset>,
  visibility: ProtocolFieldVisibility,
): ProtocolVisibleDatasetFields | null {
  const entry = Object.hasOwn(visibility.datasets, String(dataset.name))
    ? visibility.datasets[String(dataset.name)]
    : undefined;
  if (entry === undefined) return null;

  const dimensions = pick(dataset.dimensions.map(dimension => String(dimension.name)), entry.dimensions);
  const timeField = dataset.timeField !== undefined && dimensions.has(String(dataset.timeField));
  for (const relationship of dataset.relationships) {
    const target = datasets.get(String(relationship.target));
    const targetEntry = target && Object.hasOwn(visibility.datasets, String(target.name))
      ? visibility.datasets[String(target.name)]
      : undefined;
    if (!target || targetEntry === undefined) continue;
    const visible = pick(target.dimensions.map(dimension => String(dimension.name)), targetEntry.dimensions);
    for (const name of visible) dimensions.add(`${String(relationship.name)}.${name}`);
  }

  const filters = new Set(
    dataset.filters
      .filter(filter => dimensions.has(String(filter.field)))
      .map(filter => String(filter.name)),
  );

  const byName = new Map<string, object>(dataset.measures.map(measure => [String(measure.name), measure]));
  const listed = pick([...byName.keys()], entry.measures);
  const decided = new Map<string, boolean>();
  const isVisible = (name: string, path: ReadonlySet<string>): boolean => {
    const known = decided.get(name);
    if (known !== undefined) return known;
    const measure = byName.get(name);
    // A cycle can't occur in a valid contract; refuse rather than recurse.
    const visible = measure !== undefined
      && listed.has(name)
      && !path.has(name)
      && (!isTimeMeasure(measure) || timeField)
      && measureInputs(measure).every(input => isVisible(input, new Set([...path, name])));
    decided.set(name, visible);
    return visible;
  };
  const measures = new Set([...byName.keys()].filter(name => isVisible(name, new Set())));

  return Object.freeze({ dimensions, measures, filters, timeField });
}
