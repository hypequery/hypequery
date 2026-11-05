/** Kill-switch lists are per CLI: the Python and TypeScript packages version independently. */
export type TelemetryConfig = { token: string; host: string; secret: string; disabledVersions: Set<string>; disabledPythonVersions: Set<string> };
const versionList = (value: string | undefined) => new Set((value ?? '').split(',').map(item => item.trim()).filter(Boolean));
export type TelemetryEnvironment = Record<string, string | undefined>;

export function telemetryConfig(env: TelemetryEnvironment): TelemetryConfig | null {
  const token = env.POSTHOG_PROJECT_TOKEN?.trim();
  const secret = env.TELEMETRY_PROJECT_HMAC_SECRET;
  if (!token || !secret || Buffer.byteLength(secret) < 32) return null;
  try {
    const host = new URL(env.POSTHOG_HOST ?? 'https://us.i.posthog.com');
    if (host.protocol !== 'https:' || host.username || host.password || host.search || host.hash || host.pathname !== '/') return null;
    return { token, secret, host: host.origin, disabledVersions: versionList(env.TELEMETRY_DISABLED_CLI_VERSIONS),
      disabledPythonVersions: versionList(env.TELEMETRY_DISABLED_PYTHON_CLI_VERSIONS) };
  } catch {
    return null;
  }
}
