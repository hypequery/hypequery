import { apiClient, gatewayTelemetryUrl } from './api-client';

/**
 * UI-side usage beacon. Events go same-origin to the gateway
 * (POST {gateway}/telemetry), which validates them against an allowlist and
 * forwards through its anonymous pipeline — the browser never talks to any
 * third party, and everything is a no-op when the gateway has telemetry
 * disabled. Fire-and-forget: failures are swallowed.
 *
 * The contract requires the UI not to beacon unless the gateway advertises
 * the `telemetry` capability (Cloud gateways omit it). The capability is
 * resolved from GET /meta once and cached; events fired before it resolves
 * are held briefly and dropped if the gateway turns out not to support it.
 */

const onceSent = new Set<string>();

let telemetrySupported: Promise<boolean> | null = null;

function isTelemetrySupported(): Promise<boolean> {
  telemetrySupported ??= apiClient
    .getMeta()
    .then((meta) => meta.capabilities.includes('telemetry'))
    .catch(() => false);
  return telemetrySupported;
}

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
    void isTelemetrySupported()
      .then((supported) => {
        if (!supported) return;
        return fetch(gatewayTelemetryUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: [{ name, props }] }),
          keepalive: true,
        });
      })
      .catch(() => {});
  } catch {
    // Telemetry must never break the UI.
  }
}
