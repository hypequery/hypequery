import type { ExecutionContext, SemanticStreamMeta } from '../types.js';
import type { ResultLimitMeta } from './result-limits.js';
import { serializeSemanticMeasureValues } from './semantic-result-serialization.js';
import { getRuntimeTenantId } from './tenant-runtime.js';

/** Applies the row wire contract (measures as strings) to each streamed batch. */
export function serializeMeasureBatches<T>(
  batches: ReadableStream<T[]>,
  measureNames: readonly string[],
): ReadableStream<T[]> {
  return batches.pipeThrough(new TransformStream<T[], T[]>({
    transform(batch, controller) {
      controller.enqueue(serializeSemanticMeasureValues(batch, measureNames));
    },
  }));
}

export function semanticStreamMeta(
  sql: string,
  context: ExecutionContext | undefined,
  resultLimit: ResultLimitMeta | undefined,
): SemanticStreamMeta {
  return {
    sql,
    tenant: getRuntimeTenantId(context),
    ...(resultLimit ? { resultLimit } : {}),
  };
}
