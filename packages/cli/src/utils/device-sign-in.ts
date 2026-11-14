import { CliError, cloudHttpError } from './cli-error.js';
import { parseCloudErrorBody } from './cloud-error-body.js';
import { readCapped } from './read-capped.js';

/**
 * Device sign-in (RFC 8628) against hypequery Cloud (AG-05). The CLI asks for
 * a device code, a person approves its user code in any browser, and the CLI
 * polls until Cloud hands over a management token.
 */
export const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
export const DEVICE_CLIENT_ID = 'hypequery-cli';

const MAX_RESPONSE_BYTES = 64 * 1024;
/** RFC 8628 §3.2: five seconds when the server names no interval. */
const DEFAULT_INTERVAL_SECONDS = 5;
/** RFC 8628 §3.5: `slow_down` adds five seconds. */
const SLOW_DOWN_STEP_SECONDS = 5;
const MAX_INTERVAL_SECONDS = 60;
/** Never wait longer than an hour, whatever the server says. */
const MAX_EXPIRES_IN_SECONDS = 60 * 60;
/** Consecutive network or server failures tolerated while polling. */
const MAX_POLL_FAILURES = 3;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export interface DeviceAuthorization {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete?: string;
  /** Epoch milliseconds after which the device code is useless. */
  readonly expiresAt: number;
  /** Seconds between polls. */
  readonly interval: number;
}

export interface DeviceSignInRequest {
  readonly origin: string;
  /** Limit the management token to this Cloud project (slug). */
  readonly project?: string;
  /** Cap the management token to these capabilities. */
  readonly capabilities?: readonly string[];
}

export interface DeviceSignInDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly requestTimeoutMs?: number;
}

const REQUEST_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(utf8Decoder.decode(await readCapped(response, MAX_RESPONSE_BYTES))) as unknown;
  } catch {
    return null;
  }
}

function unreachable(origin: string, error: unknown): CliError {
  const reason = error instanceof Error ? error.message : String(error);
  return new CliError('CLOUD_UNREACHABLE', `Could not reach hypequery Cloud at ${origin}: ${reason}`, {
    hint: 'Check the network and HYPEQUERY_CLOUD_URL, then run `hypequery login --device` again.',
    exitClass: 'transient',
    telemetryCode: 'cloud_network_error',
  });
}

/** A URL Cloud asked the person to open: it must be on Cloud's own origin. */
function sameOriginUrl(value: unknown, origin: string): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Cloud's description reaches a terminal: no control characters, bounded length. */
function errorDescription(body: unknown): string | undefined {
  if (!isRecord(body) || typeof body.error_description !== 'string') return undefined;
  const text = body.error_description.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500).trim();
  return text || undefined;
}

function positiveSeconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function clampInterval(seconds: number): number {
  return Math.min(Math.max(seconds, 1), MAX_INTERVAL_SECONDS);
}

/** `POST /api/cli/device/code`: the project limit and capability cap are fixed here. */
export async function startDeviceAuthorization(
  request: DeviceSignInRequest,
  dependencies: DeviceSignInDependencies = {},
): Promise<DeviceAuthorization> {
  const send = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  let response: Response;
  try {
    response = await send(new URL('/api/cli/device/code', request.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: DEVICE_CLIENT_ID,
        ...(request.project !== undefined ? { project: request.project } : {}),
        ...(request.capabilities !== undefined ? { capabilities: request.capabilities } : {}),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw unreachable(request.origin, error);
  }
  const body = await readJson(response);
  if (!response.ok) {
    // A Cloud from before device sign-in has no such route.
    if (response.status === 404 || response.status === 405) {
      throw new CliError('CLOUD_DEVICE_SIGN_IN_UNSUPPORTED',
        `hypequery Cloud at ${request.origin} does not support device sign-in. `
        + 'Run `hypequery login` where a browser can open, or set HYPEQUERY_API_TOKEN.', {
          hint: 'Run `hypequery login` where a browser can open, or set HYPEQUERY_API_TOKEN.',
        });
    }
    const error = isRecord(body) ? body.error : undefined;
    const description = errorDescription(body);
    if (response.status === 400 && (error === 'invalid_scope' || error === 'invalid_request')) {
      throw new CliError('CLOUD_DEVICE_SIGN_IN_REFUSED',
        `Cloud refused to start device sign-in${description ? `: ${description}` : '.'} `
        + 'Check --project and --capabilities.', {
          hint: 'Check --project and --capabilities, then run `hypequery login --device` again.',
        });
    }
    throw cloudHttpError(
      response.status,
      `Cloud could not start device sign-in (HTTP ${response.status}).`,
      parseCloudErrorBody(JSON.stringify(body ?? {})),
    );
  }
  if (!isRecord(body)) throw new Error('Cloud returned an invalid device sign-in response.');
  const verificationUri = sameOriginUrl(body.verification_uri, request.origin);
  const verificationUriComplete = sameOriginUrl(body.verification_uri_complete, request.origin);
  const expiresIn = positiveSeconds(body.expires_in);
  if (
    typeof body.device_code !== 'string'
    || body.device_code.length === 0
    || body.device_code.length > 512
    || typeof body.user_code !== 'string'
    || !/^[A-Za-z0-9-]{4,32}$/.test(body.user_code)
    || verificationUri === undefined
    || (body.verification_uri_complete !== undefined && verificationUriComplete === undefined)
    || expiresIn === undefined
  ) {
    throw new Error('Cloud returned an invalid device sign-in response.');
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri,
    ...(verificationUriComplete ? { verificationUriComplete } : {}),
    expiresAt: now() + Math.min(expiresIn, MAX_EXPIRES_IN_SECONDS) * 1_000,
    interval: clampInterval(positiveSeconds(body.interval) ?? DEFAULT_INTERVAL_SECONDS),
  };
}

function expired(): CliError {
  return new CliError('CLOUD_AUTHORIZATION_TIMED_OUT',
    'Device sign-in expired before it was approved. Run `hypequery login --device` again.', {
      exitClass: 'auth',
      hint: 'Run `hypequery login --device` again and approve the code within the time shown.',
    });
}

/**
 * Polls `POST /api/cli/device/token` until the person approves or denies, or
 * the code expires. Honours `interval` and `slow_down`. Returns the success
 * body, which carries the management token.
 */
export async function pollDeviceAuthorization(
  origin: string,
  authorization: DeviceAuthorization,
  dependencies: DeviceSignInDependencies = {},
): Promise<Record<string, unknown>> {
  const send = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep
    ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  let interval = authorization.interval;
  let failures = 0;
  for (;;) {
    if (now() >= authorization.expiresAt) throw expired();
    await sleep(interval * 1_000);
    let response: Response;
    try {
      response = await send(new URL('/api/cli/device/token', origin), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          grant_type: DEVICE_CODE_GRANT_TYPE,
          device_code: authorization.deviceCode,
          client_id: DEVICE_CLIENT_ID,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // RFC 8628 §3.5: a client may keep polling through a transient failure.
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) throw unreachable(origin, error);
      continue;
    }
    const body = await readJson(response);
    if (response.ok) {
      if (!isRecord(body)) throw new Error('Cloud returned an invalid device sign-in response.');
      return body;
    }
    const error = isRecord(body) && typeof body.error === 'string' ? body.error : undefined;
    const description = errorDescription(body);
    const serverInterval = isRecord(body) ? positiveSeconds(body.interval) : undefined;
    if (error === 'authorization_pending') {
      failures = 0;
      if (serverInterval !== undefined) interval = clampInterval(serverInterval);
      continue;
    }
    if (error === 'slow_down' || response.status === 429) {
      failures = 0;
      interval = clampInterval(Math.max(serverInterval ?? 0, interval + SLOW_DOWN_STEP_SECONDS));
      continue;
    }
    if (error === 'expired_token') throw expired();
    if (error === 'access_denied') {
      throw new CliError('CLOUD_AUTHORIZATION_DECLINED',
        `Device sign-in was denied${description ? `: ${description}` : '.'} Run \`hypequery login --device\` again to retry.`, {
          exitClass: 'auth',
          hint: 'Run `hypequery login --device` again and approve the code in the browser.',
        });
    }
    if (error === 'invalid_grant') {
      throw new CliError('CLOUD_AUTHORIZATION_DECLINED',
        'Cloud no longer recognises this device sign-in. Run `hypequery login --device` again.', {
          exitClass: 'auth',
          hint: 'Run `hypequery login --device` again.',
        });
    }
    if (response.status >= 500) {
      failures += 1;
      if (failures < MAX_POLL_FAILURES) continue;
    }
    throw cloudHttpError(
      response.status,
      `Cloud rejected the device sign-in poll (HTTP ${response.status}${error ? `, ${error}` : ''}).`,
      parseCloudErrorBody(JSON.stringify(body ?? {})),
    );
  }
}
