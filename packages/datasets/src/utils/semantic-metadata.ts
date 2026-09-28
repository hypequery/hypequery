import type { SemanticMetadata } from '../types.js';
import { uniqueSorted } from './canonical-json.js';

/** Copy agent metadata without carrying unrelated config fields into public contracts. */
export function snapshotSemanticMetadata(metadata: SemanticMetadata): SemanticMetadata {
  if ('timezone' in metadata) {
    throw new Error('Set timezone on createDatasetClient or the query, not semantic metadata.');
  }
  return {
    ...(metadata.examples !== undefined ? { examples: uniqueSorted(metadata.examples) } : {}),
    ...(metadata.synonyms !== undefined ? { synonyms: uniqueSorted(metadata.synonyms) } : {}),
    ...(metadata.format !== undefined ? { format: metadata.format } : {}),
    ...(metadata.unit !== undefined ? { unit: metadata.unit } : {}),
    ...(metadata.currency !== undefined ? { currency: metadata.currency } : {}),
    ...(metadata.sensitivity !== undefined ? { sensitivity: metadata.sensitivity } : {}),
  };
}
