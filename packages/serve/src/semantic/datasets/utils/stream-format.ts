/** Media type of a streamed dataset response of row batches, one JSON frame per line. */
export const NDJSON_MEDIA_TYPE = 'application/x-ndjson';
/** Media type of a streamed dataset response as an Arrow IPC stream. */
export const ARROW_STREAM_MEDIA_TYPE = 'application/vnd.apache.arrow.stream';

export type DatasetStreamFormat = 'ndjson' | 'arrow';

// A Map, not an object literal: a media type such as `constructor` must not
// match an inherited property.
const FORMATS = new Map<string, DatasetStreamFormat>([
  [NDJSON_MEDIA_TYPE, 'ndjson'],
  [ARROW_STREAM_MEDIA_TYPE, 'arrow'],
]);

interface MediaRange {
  type: string;
  quality: number;
}

const parseAccept = (accept: string): MediaRange[] =>
  accept.split(',').flatMap((range) => {
    const [type, ...params] = range.trim().toLowerCase().split(';').map(part => part.trim());
    if (!type) return [];
    const q = params.find(param => param.startsWith('q='));
    const quality = q === undefined ? 1 : Number(q.slice(2));
    return [{ type, quality: Number.isFinite(quality) ? quality : 0 }];
  });

/** The quality of the most specific range matching `application/json`, or 0 when none does. */
const jsonQuality = (ranges: MediaRange[]) => {
  for (const type of ['application/json', 'application/*', '*/*']) {
    const range = ranges.find(candidate => candidate.type === type);
    if (range) return range.quality;
  }
  return 0;
};

/**
 * The stream an `Accept` header asks for, or `undefined` for a JSON page.
 * Streams are matched only by their exact media type, never by a wildcard.
 * The acceptable stream type with the highest `q` wins (the first listed on a
 * tie); a JSON page is preferred only when `application/json` (or the most
 * specific wildcard covering it) has a strictly higher `q`. `q=0` refuses a type.
 */
export function requestedStreamFormat(accept: string | undefined): DatasetStreamFormat | undefined {
  if (!accept) return undefined;
  const ranges = parseAccept(accept);
  let best: { format: DatasetStreamFormat; quality: number } | undefined;
  for (const range of ranges) {
    const format = FORMATS.get(range.type);
    if (!format || range.quality <= 0) continue;
    if (!best || range.quality > best.quality) best = { format, quality: range.quality };
  }
  if (!best || jsonQuality(ranges) > best.quality) return undefined;
  return best.format;
}
