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
 * measure of the full contract, hidden ones included. Under a visibility
 * policy, spell out the visible base measures instead, so the selection the
 * executor runs is the one the visibility check saw.
 */
export function withVisibleDefaultMeasures(
  operation: ProtocolSemanticQuery,
  dataset: ProtocolDeploymentDataset,
  visible: ProtocolVisibleDatasetFields | undefined,
): ProtocolSemanticQuery {
  if (visible === undefined || operation.kind !== 'dataset' || operation.measures !== undefined) return operation;
  const measures = dataset.measures
    .filter(measure => isBaseMeasure(measure) && visible.measures.has(String(measure.name)))
    .map(measure => joinProtocolQualifiedIdentifier([measure.name]));
  return Object.freeze({ ...operation, measures });
}
