/** Media type of a streamed dataset response of row batches, one JSON frame per line. */
export const NDJSON_MEDIA_TYPE = 'application/x-ndjson';
/** Media type of a streamed dataset response as an Arrow IPC stream. */
export const ARROW_STREAM_MEDIA_TYPE = 'application/vnd.apache.arrow.stream';

export type DatasetStreamFormat = 'ndjson' | 'arrow';

const FORMATS: Record<string, DatasetStreamFormat> = {
  [NDJSON_MEDIA_TYPE]: 'ndjson',
  [ARROW_STREAM_MEDIA_TYPE]: 'arrow',
};

/**
 * The stream an `Accept` header asks for, or `undefined` for a JSON page. The
 * first acceptable stream type listed wins; `q=0` refuses a type.
 */
export function requestedStreamFormat(accept: string | undefined): DatasetStreamFormat | undefined {
  if (!accept) return undefined;
  for (const range of accept.split(',')) {
    const [type, ...params] = range.trim().toLowerCase().split(';').map(part => part.trim());
    const format = FORMATS[type ?? ''];
    if (!format) continue;
    const quality = params.find(param => param.startsWith('q='));
    if (quality !== undefined && Number(quality.slice(2)) === 0) continue;
    return format;
  }
  return undefined;
}
