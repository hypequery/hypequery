import { createHmac } from 'node:crypto';
import type { TelemetryConfig } from './config';
import type { WireEvent } from './validation';

export function posthogBatch(events: WireEvent[], config: TelemetryConfig): {
  token: string; batch: { event: string; timestamp: string; properties: Record<string, unknown> }[];
} {
  return {
    token: config.token,
    batch: events.map(({ event, properties, distinct_id, timestamp }) => ({
      event, timestamp,
      properties: {
        ...properties,
        ...(typeof properties.project_id === 'string' ? {
          project_id: createHmac('sha256', config.secret).update(properties.project_id).digest('hex'),
        } : {}),
        distinct_id,
      },
    })),
  };
}

/** Best effort: no retries, request metadata, payload logs or persistent queue. */
export async function forwardTelemetry(events: WireEvent[], config: TelemetryConfig, send: typeof fetch = fetch): Promise<void> {
  try {
    const response = await send(`${config.host}/batch/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(posthogBatch(events, config)),
      signal: AbortSignal.timeout(3000), redirect: 'error',
    });
    await response.body?.cancel();
    if (!response.ok) console.error('CLI telemetry forwarding failed: upstream status', response.status);
  } catch {
    console.error('CLI telemetry forwarding failed');
  }
}
