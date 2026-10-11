export type TelemetryConfig = { token: string; host: string; secret: string; disabledVersions: Set<string> };
export type TelemetryEnvironment = Record<string, string | undefined>;

export function telemetryConfig(env: TelemetryEnvironment): TelemetryConfig | null {
  const token = env.POSTHOG_PROJECT_TOKEN?.trim();
  const secret = env.TELEMETRY_PROJECT_HMAC_SECRET;
  if (!token || !secret || Buffer.byteLength(secret) < 32) return null;
  try {
    const host = new URL(env.POSTHOG_HOST ?? 'https://us.i.posthog.com');
    if (host.protocol !== 'https:' || host.username || host.password || host.search || host.hash || host.pathname !== '/') return null;
    return { token, secret, host: host.origin, disabledVersions: new Set(
      (env.TELEMETRY_DISABLED_CLI_VERSIONS ?? '').split(',').map(value => value.trim()).filter(Boolean),
    ) };
  } catch {
    return null;
  }
}
