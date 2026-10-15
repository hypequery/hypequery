import { clientError } from './errors.js';
/** Run count budgets on the detached JSON tree before descriptor validation. */
export function boundClientDescriptors(raw: Record<string, unknown>): void {
  if (!Array.isArray(raw.endpoints)) return;
  if (raw.endpoints.length > 256) clientError('HQ_CLIENT_LIMIT', '/endpoints');
  let descriptors = 0;
  for (const [index, endpoint] of raw.endpoints.entries()) {
    if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) continue;
    for (const key of ['dimensions', 'measures', 'filters']) {
      const value = endpoint[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const count = Object.keys(value).length;
        if (count > 256) clientError('HQ_CLIENT_LIMIT', `/endpoints/${index}/${key}`);
        descriptors += count;
        if (descriptors > 16384) clientError('HQ_CLIENT_LIMIT', `/endpoints/${index}`);
      }
    }
  }
}
