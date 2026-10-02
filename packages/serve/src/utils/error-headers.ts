import { generateRequestId } from '../utils.js';

/** Override cache policy regardless of the supplied header casing. */
export function withNoStoreErrorHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'cache-control'),
    ),
    'cache-control': 'no-store',
  };
}

/** Headers for errors answered by an adapter outside the request pipeline. */
export function adapterErrorHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  return {
    ...withNoStoreErrorHeaders(Object.fromEntries(
      Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'x-request-id'),
    )),
    'x-request-id': generateRequestId(),
  };
}
