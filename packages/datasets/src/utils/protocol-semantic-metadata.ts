import type { ProtocolSemanticMetadata } from '@hypequery/protocol';
import type { SemanticMetadata } from '../types.js';
import { snapshotSemanticMetadata } from './semantic-metadata.js';

/** Map local semantic metadata onto its portable protocol representation. */
export function toProtocolSemanticMetadata(
  metadata: SemanticMetadata,
): ProtocolSemanticMetadata {
  return snapshotSemanticMetadata(metadata);
}
