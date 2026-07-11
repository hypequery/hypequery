import type { EndpointContext } from './types.js';
import { parseBody, sendJSON, sendError } from './helpers.js';
import { UI_EVENT_ALLOWLIST } from '../telemetry.js';

const MAX_EVENTS_PER_BATCH = 20;
const MAX_PROP_ENTRIES = 10;

interface BeaconBody {
  events?: Array<{ name?: unknown; props?: unknown }>;
}

/** Keep only shallow primitive props, capped, so the UI can never smuggle payloads. */
function sanitizeProps(props: unknown): Record<string, string | number | boolean> | undefined {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, value] of Object.entries(props)) {
    if (count >= MAX_PROP_ENTRIES) break;
    if (typeof value === 'string') {
      out[key] = value.slice(0, 100);
      count++;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      count++;
    }
  }
  return count > 0 ? out : undefined;
}

/**
 * POST /__dev/telemetry
 * Beacon for UI usage events. The browser only ever talks to the gateway
 * (same-origin); the gateway forwards allowlisted events through the same
 * anonymous pipeline as server events. 204 always — including when telemetry
 * is disabled — so the UI needs no telemetry-awareness.
 */
export async function postTelemetry(ctx: EndpointContext): Promise<void> {
  try {
    const body = (await parseBody(ctx.req)) as BeaconBody;
    const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS_PER_BATCH) : [];

    if (ctx.telemetry) {
      for (const event of events) {
        if (typeof event?.name === 'string' && UI_EVENT_ALLOWLIST.has(event.name)) {
          ctx.telemetry.track(`ui_${event.name}`, sanitizeProps(event.props));
        }
      }
    }

    ctx.res.writeHead(204);
    ctx.res.end();
  } catch (error) {
    // Malformed beacon bodies are the client's problem, not the server log's.
    sendError(ctx.res, (error as Error).message, 400);
  }
}

/**
 * GET /__dev/telemetry
 * Transparency endpoint: report whether telemetry is enabled so the UI (and
 * curious users) can see the state.
 */
export async function getTelemetryStatus(ctx: EndpointContext): Promise<void> {
  sendJSON(ctx.res, {
    enabled: ctx.telemetry?.enabled ?? false,
    optOut: 'HYPEQUERY_TELEMETRY_DISABLED=1',
    docs: 'https://hypequery.com/telemetry'
  });
}
