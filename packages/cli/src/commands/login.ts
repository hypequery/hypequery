import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import open from 'open';
import { validateProtocolDeploymentReleaseTarget } from '@hypequery/protocol';

import {
  CLOUD_SOURCE_SCOPE,
  deleteCloudCredential,
  loadCloudCredential,
  normalizeCloudDeploymentEndpoint,
  normalizeCloudOrigin,
  saveCloudCredential,
  type StoredCloudCredential,
} from '../utils/cloud-credential-store.js';
import { logger } from '../utils/logger.js';

const DEFAULT_CLOUD_URL = 'https://cloud.hypequery.com';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
// Cloud issues 12-hour credentials; allow limited client/server clock skew.
const MAX_TOKEN_LIFETIME_MS = 13 * 60 * 60_000;
// Cloud owns the token format. Validate only what protects this client — an
// opaque, header-safe bearer credential of a sane length — rather than pinning
// a version prefix or exact length that would break every already-published
// CLI the day Cloud rotates its token format.
const TOKEN_PATTERN = /^hqdp_[A-Za-z0-9_-]{16,512}$/;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export interface LoginOptions {
  readonly cloudUrl?: string;
  /** Stable Cloud deployment target. */
  readonly environment?: string;
}

export interface LoginDependencies {
  readonly fetch?: typeof fetch;
  readonly openBrowser?: (url: string) => Promise<unknown>;
  readonly now?: () => number;
  readonly requestTimeoutMs?: number;
  readonly saveCredential?: typeof saveCloudCredential;
  readonly timeoutMs?: number;
}

export interface LogoutDependencies {
  readonly fetch?: typeof fetch;
  readonly loadCredential?: typeof loadCloudCredential;
  readonly deleteCredential?: typeof deleteCloudCredential;
  readonly requestTimeoutMs?: number;
}

/**
 * The page the browser lands on once Cloud hands the authorization code back.
 *
 * Served from the loopback listener, under a `default-src 'none'` policy that
 * only relaxes `style-src` — so everything is inline and there are no images or
 * webfonts to fetch. Colours mirror the Cloud palette and follow the operating
 * system's light/dark preference.
 */
export function callbackHtml(success: boolean) {
  const title = success ? 'CLI authorized' : 'Authorization failed';
  const status = success ? 'Connected' : 'Failed';
  const heading = success ? 'hypequery CLI is authorized' : 'Authorization failed';
  const message = success
    ? 'You can close this window and return to your terminal.'
    : 'Return to your terminal and run the login command again.';
  const state = success ? 'ok' : 'bad';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · hypequery</title>
<style>
:root{
color-scheme:light dark;
--bg:#faf9f7;--panel:#ffffff;--border:rgba(0,0,0,.08);
--text:#1a1a1a;--muted:#5a5d63;--dim:#8b8d92;
--ok:#22a06b;--ok-soft:rgba(34,160,107,.12);
--bad:#dc2626;--bad-soft:rgba(220,38,38,.10);
}
@media (prefers-color-scheme:dark){:root{
--bg:#0c0e14;--panel:#161922;--border:rgba(255,255,255,.07);
--text:#f5f3ee;--muted:#a0a3ad;--dim:#8b8f99;
--ok:#34d399;--ok-soft:rgba(52,211,153,.12);
--bad:#f87171;--bad-soft:rgba(248,113,113,.12);
}}
*{box-sizing:border-box}
html,body{height:100%}
body{
margin:0;padding:24px;background:var(--bg);color:var(--text);
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
display:flex;align-items:center;justify-content:center;
-webkit-font-smoothing:antialiased;
}
.wordmark{
position:fixed;top:26px;left:30px;
font-size:14px;font-weight:700;letter-spacing:-.035em;
}
main{width:100%;max-width:400px;background:var(--panel);border:1px solid var(--border);padding:28px}
.status{
display:inline-block;padding:5px 9px;
font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
font-size:11px;text-transform:uppercase;letter-spacing:.1em;
color:var(--${state});background:var(--${state}-soft);
}
h1{margin:20px 0 0;font-size:23px;font-weight:500;letter-spacing:-.025em;line-height:1.25}
p{margin:10px 0 0;font-size:13.5px;line-height:1.65;color:var(--muted)}
.foot{
margin-top:24px;padding-top:17px;border-top:1px solid var(--border);
font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
font-size:11.5px;letter-spacing:.04em;color:var(--dim);
}
@media (max-width:420px){.wordmark{position:static;margin-bottom:18px}body{flex-direction:column;align-items:stretch;justify-content:flex-start;padding-top:30px}}
</style>
</head>
<body>
<div class="wordmark">hypequery</div>
<main>
<span class="status">${status}</span>
<h1>${heading}</h1>
<p>${message}</p>
<div class="foot">${success ? 'Safe to close this tab' : 'hypequery login'}</div>
</main>
</body>
</html>`;
}

async function callbackServer(state: string, timeoutMs: number) {
  let settle: ((code: string) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const code = new Promise<string>((resolve, rejectPromise) => {
    settle = resolve;
    reject = rejectPromise;
  });
  // The caller only awaits `code` after the browser has been opened, which
  // takes long enough for a rejection to be seen as unhandled and terminate
  // the process. This keeps a handler attached from the very first tick.
  code.catch(() => undefined);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || url.pathname !== '/callback') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const returnedState = url.searchParams.get('state');
    const authorizationCode = url.searchParams.get('code');
    const authorizationError = url.searchParams.get('error');
    const stateMatches = returnedState === state;
    const valid = stateMatches
      && typeof authorizationCode === 'string'
      && authorizationCode.length >= 1
      && authorizationCode.length <= 4096;
    response.writeHead(valid ? 200 : 400, {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(callbackHtml(valid));
    // Only a matching callback completes the login. Any web page the user has
    // open can issue a no-CORS request to this port, so a mismatch is ignored
    // rather than settled: aborting here would let a background tab cancel a
    // legitimate login. A matching Cloud error still ends the transaction.
    if (valid) settle?.(authorizationCode as string);
    else if (stateMatches && authorizationError) {
      reject?.(new Error('Cloud authorization was not completed.'));
    }
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, rejectListen) => {
    server.once('listening', resolve);
    server.once('error', rejectListen);
  });
  const address = server.address() as AddressInfo;
  const timer = setTimeout(() => {
    reject?.(new Error('CLI authorization timed out. Run `hypequery login` again.'));
  }, timeoutMs);
  timer.unref();
  return {
    code,
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    close: () => {
      clearTimeout(timer);
      server.close();
    },
  };
}

async function boundedJsonResponse(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_TOKEN_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Cloud returned an oversized CLI token response.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(utf8Decoder.decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function tokenResponse(
  input: unknown,
  origin: string,
  now: number,
): StoredCloudCredential {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Cloud returned an invalid CLI token response.');
  }
  const value = input as Record<string, unknown>;
  if (
    typeof value.access_token !== 'string'
    || !TOKEN_PATTERN.test(value.access_token)
    || value.token_type !== 'Bearer'
    || typeof value.expires_at !== 'string'
    || !Number.isFinite(Date.parse(value.expires_at))
    || value.scope !== CLOUD_SOURCE_SCOPE
    || typeof value.deployment_endpoint !== 'string'
    || value.deployment_target === undefined
  ) {
    throw new Error('Cloud returned an invalid CLI token response.');
  }
  const expiresAt = Date.parse(value.expires_at);
  if (expiresAt <= now || expiresAt > now + MAX_TOKEN_LIFETIME_MS) {
    throw new Error('Cloud returned an invalid CLI token expiration.');
  }
  const deploymentEndpoint = normalizeCloudDeploymentEndpoint(
    value.deployment_endpoint,
    origin,
  );
  let target;
  try {
    target = validateProtocolDeploymentReleaseTarget(value.deployment_target);
  } catch {
    throw new Error('Cloud returned an invalid CLI deployment target.');
  }
  return {
    cloudUrl: origin,
    deploymentEndpoint,
    expiresAt: value.expires_at,
    scope: value.scope,
    target,
    token: value.access_token,
  };
}

export async function loginCommand(
  options: LoginOptions = {},
  dependencies: LoginDependencies = {},
) {
  const origin = normalizeCloudOrigin(
    options.cloudUrl ?? process.env.HYPEQUERY_CLOUD_URL ?? DEFAULT_CLOUD_URL,
  );
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let environment: string | undefined;
  if (options.environment !== undefined) {
    try {
      environment = validateProtocolDeploymentReleaseTarget({
        project: 'target',
        environment: options.environment,
      }).environment;
    } catch {
      throw new Error(
        'Invalid deployment environment. Use letters, numbers, dots, underscores, colons, or hyphens.',
      );
    }
  }
  const callback = await callbackServer(state, dependencies.timeoutMs ?? LOGIN_TIMEOUT_MS);
  const authorizeUrl = new URL('/cli/authorize', origin);
  authorizeUrl.searchParams.set('redirect_uri', callback.redirectUri);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);
  if (environment) authorizeUrl.searchParams.set('environment', environment);

  try {
    logger.info('Opening your browser to authorize Hypequery CLI…');
    await (dependencies.openBrowser ?? open)(authorizeUrl.toString());
    logger.info(`If the browser did not open, visit:\n${authorizeUrl}`);
    const code = await callback.code;
    callback.close();
    const request = dependencies.fetch ?? fetch;
    const response = await request(new URL('/api/cli/token', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: callback.redirectUri,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(
        dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
      ),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Cloud rejected the CLI authorization code. Run `hypequery login` again.');
    }
    const body = await boundedJsonResponse(response);
    const credential = tokenResponse(
      body,
      origin,
      (dependencies.now ?? Date.now)(),
    );
    await (dependencies.saveCredential ?? saveCloudCredential)(credential);
    logger.success('Logged in to Hypequery Cloud');
    // Cloud resolves the target, so print what was actually issued rather than
    // what was requested.
    if (credential.target) {
      logger.info(
        `Deployments target ${credential.target.project} / ${credential.target.environment}`,
      );
    }
    logger.info(`Credential expires ${new Date(credential.expiresAt).toLocaleString()}`);
  } finally {
    callback.close();
  }
}

export async function logoutCommand(dependencies: LogoutDependencies = {}) {
  const load = dependencies.loadCredential ?? loadCloudCredential;
  const remove = dependencies.deleteCredential ?? deleteCloudCredential;
  let credential: StoredCloudCredential | null = null;
  let unreadable = false;
  try {
    credential = await load();
  } catch {
    // Logout is the command users reach for when local state is broken, so a
    // corrupt profile or an unreachable vault must not block the cleanup below.
    unreadable = true;
    logger.warn('The stored Cloud credential could not be read; removing local state without revoking. The token will expire automatically.');
  }
  if (!credential && !unreadable) {
    logger.info('You are not logged in to Hypequery Cloud.');
    return;
  }
  if (credential) {
    try {
      const request = dependencies.fetch ?? fetch;
      const response = await request(new URL('/api/cli/token', credential.cloudUrl), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${credential.token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(
          dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
        ),
      });
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) throw new Error(`Cloud returned HTTP ${response.status}.`);
    } catch {
      logger.warn('Cloud could not be reached; the local credential was removed and the token will expire automatically.');
    }
  }
  await remove();
  logger.success('Logged out of Hypequery Cloud');
}
