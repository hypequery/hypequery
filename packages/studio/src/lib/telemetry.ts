import { gatewayTelemetryUrl } from './api-client';

/**
 * UI-side usage beacon. Events go same-origin to the gateway
 * (POST {gateway}/telemetry), which validates them against an allowlist and
 * forwards through its anonymous pipeline — the browser never talks to any
 * third party, and everything is a no-op when the gateway has telemetry
 * disabled. Fire-and-forget: failures are swallowed.
 */

const onceSent = new Set<string>();

export function track(
  name: string,
  props?: Record<string, string | number | boolean>,
  options?: { once?: boolean }
): void {
  if (options?.once) {
    const key = `${name}:${JSON.stringify(props ?? {})}`;
    if (onceSent.has(key)) return;
    onceSent.add(key);
  }

  try {
    void fetch(gatewayTelemetryUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [{ name, props }] }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry must never break the UI.
  }
}
