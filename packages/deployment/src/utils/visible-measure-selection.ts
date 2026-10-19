import type {
  ProtocolDeploymentDataset,
  ProtocolSemanticQuery,
  ProtocolVisibleDatasetFields,
} from '@hypequery/protocol';
import { joinProtocolQualifiedIdentifier } from '@hypequery/protocol';

/** A measure computed from no other measure: neither derived (`uses`) nor a time measure (`measure`). */
function isBaseMeasure(measure: object): boolean {
  return !('uses' in measure) && !('measure' in measure);
}

/**
 * A dataset operation that omits `measures` asks the executor for every base
 * measure of the full contract. When the visibility policy hides any of them,
 * spell out the visible base measures instead, so the selection the executor
 * runs is one the visibility check allows. When none is hidden the operation
 * is returned unchanged and keeps the executor's default selection.
 */
export function withVisibleDefaultMeasures(
  operation: ProtocolSemanticQuery,
  dataset: ProtocolDeploymentDataset,
  visible: ProtocolVisibleDatasetFields | undefined,
): ProtocolSemanticQuery {
  if (visible === undefined || operation.kind !== 'dataset' || operation.measures !== undefined) return operation;
  const base = dataset.measures.filter(isBaseMeasure);
  const shown = base.filter(measure => visible.measures.has(String(measure.name)));
  if (shown.length === base.length) return operation;
  return Object.freeze({ ...operation, measures: shown.map(measure => joinProtocolQualifiedIdentifier([measure.name])) });
}
