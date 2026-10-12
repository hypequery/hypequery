import { readTelemetryBody } from './body';
import { telemetryConfig, type TelemetryEnvironment } from './config';
import { forwardTelemetry } from './forward';
import { firewallRateLimit, type RateLimiter } from './rate-limit';
import { validateBatch } from './validation';

type Schedule = (callback: () => Promise<void>) => void;

export async function handleTelemetry(
  request: Request, schedule: Schedule, env: TelemetryEnvironment = process.env, rateLimit: RateLimiter = firewallRateLimit,
): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' };
  const config = telemetryConfig(env);
  if (!config) return new Response(null, { status: 503, headers });
  // Checked before reading the body; the CLI drops a 429 without retrying.
  const limit = await rateLimit(request);
  if (limit === 'unconfigured') return new Response(null, { status: 503, headers });
  if (limit === 'limited') return new Response(null, { status: 429, headers });
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    || (request.headers.get('content-encoding') ?? 'identity') !== 'identity') return new Response(null, { status: 415, headers });
  let input: unknown;
  try {
    input = await readTelemetryBody(request);
  } catch (error) {
    return new Response(null, { status: error instanceof RangeError ? 413 : 400, headers });
  }
  if (!validateBatch(input)) return new Response(null, { status: 400, headers });
  // A 410 permanently disables this CLI version on the installation. Do not use
  // it for configuration errors, PostHog outages or malformed requests.
  if (input.batch.some(event => config.disabledVersions.has(event.properties.cli_version as string))) {
    return new Response(null, { status: 410, headers });
  }
  schedule(() => forwardTelemetry(input.batch, config));
  return new Response(null, { status: 202, headers });
}
