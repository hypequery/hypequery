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

/**
 * Whether a relationship's local join keys are visible. A joined `to` field
 * holds the same values as its `from` key, so exposing the join while hiding
 * the key would let a caller read the key back through the relationship.
 * Execution joins on keys as physical columns, so a key counts as visible only
 * when a visible dimension reads that column. A dimension merely named like
 * the key doesn't count: it may read a different column.
 */
function joinKeysVisible(
  relationship: ProtocolDeploymentDataset['relationships'][number],
  dataset: ProtocolDeploymentDataset,
  visible: ReadonlySet<string>,
  allDimensions: boolean,
): boolean {
  if (allDimensions) return true;
  const keys = [String(relationship.from), ...(relationship.keys ?? []).map(key => String(key.from))];
  return keys.every(key => dataset.dimensions.some(dimension => (
    visible.has(String(dimension.name))
    && dimension.source.kind === 'column'
    && dimension.source.column === key
  )));
}

/** A measure over the dataset's time axis (window or shift), which needs the time field. */
function isTimeMeasure(measure: object): boolean {
  return 'measure' in measure && typeof measure.measure === 'string';
}

/**
 * What one dataset exposes under a visibility policy, or null when the policy
 * hides the dataset (RFC 0019).
 *
 * Names the policy lists but the contract doesn't have are ignored, so a
 * policy written against one release keeps working after a later release
 * removes a field. Visibility only narrows: a dimension the contract marks
 * non-groupable or non-filterable stays so.
 *
 * - A one-hop `relationship.dimension` is visible only when the target dataset
 *   and that dimension are visible in the target's own entry, and the
 *   relationship's local join keys are visible.
 * - A declared filter is visible only when the dimension it filters is.
 * - The time field is visible only as a visible dimension; grouping by period
 *   and time measures need it.
 * - A measure is visible only when it is listed and every measure it is
 *   computed from is visible too. A derived ratio over a hidden measure would
 *   let a caller recover the hidden value.
 * - Measures are authorized by name, independently of the dimensions they
 *   aggregate: `revenue = sum(amount)` stays visible with `amount` hidden. A
 *   `min`, `max`, `argMax` or `countDistinct` over a hidden dimension reveals
 *   its values, so list measures explicitly rather than use `*` when a dataset
 *   has any that must stay hidden; `*` also exposes measures added later.
 * - Segments are not narrowed. Deployment contract 2, which this resolves, has
 *   none.
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

  const local = pick(dataset.dimensions.map(dimension => String(dimension.name)), entry.dimensions);
  const dimensions = new Set(local);
  const timeField = dataset.timeField !== undefined && local.has(String(dataset.timeField));
  const relationships = new Set<string>();
  for (const relationship of dataset.relationships) {
    const target = datasets.get(String(relationship.target));
    const targetEntry = target && Object.hasOwn(visibility.datasets, String(target.name))
      ? visibility.datasets[String(target.name)]
      : undefined;
    if (!target || targetEntry === undefined) continue;
    if (!joinKeysVisible(relationship, dataset, local, entry.dimensions === '*')) continue;
    relationships.add(String(relationship.name));
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

  return Object.freeze({ dimensions, measures, filters, relationships, timeField });
}
