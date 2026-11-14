/**
 * Slack request signing (v0): `v0=` + hex(HMAC-SHA256(signingSecret,
 * `v0:${timestamp}:${rawBody}`)). Uses Web Crypto, so it runs on Node.js 20+,
 * Deno, Bun, Cloudflare Workers and Vercel Edge.
 *
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */

/** Slack's recommended replay window. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SlackVerificationFailure =
  | 'missing_signing_secret'
  | 'missing_headers'
  | 'invalid_timestamp'
  | 'stale_timestamp'
  | 'invalid_signature';

export type SlackVerificationResult =
  | { ok: true }
  | { ok: false; reason: SlackVerificationFailure };

export interface VerifySlackRequestOptions {
  signingSecret: string;
  /** The raw request body, exactly as received. Never a re-serialized object. */
  body: string;
  /** `X-Slack-Request-Timestamp`. */
  timestamp: string | null | undefined;
  /** `X-Slack-Signature`. */
  signature: string | null | undefined;
  /** Seconds a request stays valid. @default 300 */
  toleranceSeconds?: number;
  /** Current time in milliseconds, for tests. @default Date.now() */
  now?: number;
}

const encoder = new TextEncoder();

export async function verifySlackRequest(options: VerifySlackRequestOptions): Promise<SlackVerificationResult> {
  const { signingSecret, body, timestamp, signature } = options;
  if (!signingSecret) return { ok: false, reason: 'missing_signing_secret' };
  if (!timestamp || !signature) return { ok: false, reason: 'missing_headers' };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'invalid_timestamp' };

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > tolerance) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  if (!signature.startsWith('v0=')) return { ok: false, reason: 'invalid_signature' };
  const expected = await signSlackRequest(signingSecret, timestamp, body);
  return timingSafeEqual(expected, signature) ? { ok: true } : { ok: false, reason: 'invalid_signature' };
}

/** The `X-Slack-Signature` value Slack would send for this body. Exported for tests and local tooling. */
export async function signSlackRequest(signingSecret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`v0:${timestamp}:${body}`));
  return `v0=${toHex(new Uint8Array(mac))}`;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Compares in time that depends only on the length of `expected`. */
function timingSafeEqual(expected: string, actual: string): boolean {
  let diff = expected.length ^ actual.length;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ (actual.charCodeAt(i) || 0);
  }
  return diff === 0;
}
