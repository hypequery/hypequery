import type { EndpointContext } from './types.js';
import { sendJSON, sendError } from './helpers.js';

/** Contract version implemented by this gateway. */
export const CONTRACT_VERSION = '0.1';

/**
 * GET /__dev/meta
 * Discovery endpoint: the studio UI reads this first and renders only what the
 * gateway advertises. See plans/gateway-contract.md.
 */
export async function getMeta(ctx: EndpointContext): Promise<void> {
  try {
    sendJSON(ctx.res, {
      contractVersion: CONTRACT_VERSION,
      mode: 'local',
      capabilities: ctx.capabilities,
      project: { name: ctx.projectName ?? 'hypequery' }
    });
  } catch (error) {
    console.error('[gateway] getMeta error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}
