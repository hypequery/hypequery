import type { EndpointContext } from './types.js';
import { sendJSON, sendError } from './helpers.js';
import { GATEWAY_CONTRACT_VERSION, type GatewayMeta } from '@hypequery/gateway-contract';

/** Contract version implemented by this gateway. */
export const CONTRACT_VERSION = GATEWAY_CONTRACT_VERSION;

/**
 * GET /__dev/meta
 * Discovery endpoint: the studio UI reads this first and renders only what the
 * gateway advertises. See plans/gateway-contract.md.
 */
export async function getMeta(ctx: EndpointContext): Promise<void> {
  try {
    const meta: GatewayMeta = {
      contractVersion: CONTRACT_VERSION,
      mode: 'local',
      capabilities: ctx.capabilities,
      project: { name: ctx.projectName ?? 'hypequery' }
    };
    sendJSON(ctx.res, meta);
  } catch (error) {
    console.error('[gateway] getMeta error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}
