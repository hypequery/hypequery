import { checkRateLimit } from '@vercel/firewall';

/** Must match the rate-limit ID of the Vercel Firewall rule that guards this endpoint. */
export const TELEMETRY_RATE_LIMIT_ID = 'cli-telemetry';

export type RateLimitResult = 'allowed' | 'limited' | 'unconfigured';
export type RateLimiter = (request: Request) => Promise<RateLimitResult>;

/** A missing rule fails closed; transient firewall errors fail open so outages do not drop telemetry. */
export async function firewallRateLimit(request: Request): Promise<RateLimitResult> {
  try {
    const { rateLimited, error } = await checkRateLimit(TELEMETRY_RATE_LIMIT_ID, { request, timeout: 1000 });
    if (error === 'not-found') return 'unconfigured';
    return rateLimited ? 'limited' : 'allowed';
  } catch {
    console.error('CLI telemetry rate limit check failed');
    return 'allowed';
  }
}
