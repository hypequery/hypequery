import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import open from 'open';
import { validateProtocolDeploymentReleaseTarget } from '@hypequery/protocol';

import {
  deleteCloudCredential,
  loadCloudCredential,
  saveCloudCredential,
  type StoredCloudCredential,
} from '../utils/cloud-credential-store.js';
import { logger } from '../utils/logger.js';

const DEFAULT_CLOUD_URL = 'https://cloud.hypequery.com';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const TOKEN_PATTERN = /^hqdp_v1_[A-Za-z0-9_-]{43}$/;

export interface LoginOptions {
  readonly cloudUrl?: string;
}

export interface LoginDependencies {
  readonly fetch?: typeof fetch;
  readonly openBrowser?: (url: string) => Promise<unknown>;
  readonly saveCredential?: typeof saveCloudCredential;
  readonly timeoutMs?: number;
}

export interface LogoutDependencies {
  readonly fetch?: typeof fetch;
  readonly loadCredential?: typeof loadCloudCredential;
  readonly deleteCredential?: typeof deleteCloudCredential;
}

function cloudOrigin(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Cloud URL must be an absolute HTTPS URL.');
  }
  const loopback = url.protocol === 'http:'
    && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if ((url.protocol !== 'https:' && !loopback) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Cloud URL must be an HTTPS origin without a path, query, or credentials.');
  }
  return url.origin;
}

function callbackHtml(success: boolean) {
  const title = success ? 'CLI authorized' : 'Authorization failed';
  const message = success
    ? 'You can close this window and return to your terminal.'
    : 'Return to your terminal and run the login command again.';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
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
    const valid = returnedState === state && Boolean(authorizationCode);
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
    // legitimate login. The timeout remains the only failure path.
    if (valid) settle?.(authorizationCode as string);
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

function tokenResponse(input: unknown, origin: string): StoredCloudCredential {
  const value = input as Record<string, unknown>;
  if (
    typeof value.access_token !== 'string'
    || !TOKEN_PATTERN.test(value.access_token)
    || value.token_type !== 'Bearer'
    || typeof value.expires_at !== 'string'
    || !Number.isFinite(Date.parse(value.expires_at))
    || typeof value.scope !== 'string'
    || typeof value.deployment_endpoint !== 'string'
    || value.deployment_target === undefined
  ) {
    throw new Error('Cloud returned an invalid CLI token response.');
  }
  const endpoint = new URL(value.deployment_endpoint);
  if (endpoint.origin !== origin || endpoint.pathname !== '/v1/deployments/submissions'
    || endpoint.search || endpoint.hash) {
    throw new Error('Cloud returned an invalid deployment endpoint.');
  }
  let target;
  try {
    target = validateProtocolDeploymentReleaseTarget(value.deployment_target);
  } catch {
    throw new Error('Cloud returned an invalid CLI deployment target.');
  }
  return {
    cloudUrl: origin,
    deploymentEndpoint: endpoint.toString(),
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
  const origin = cloudOrigin(
    options.cloudUrl ?? process.env.HYPEQUERY_CLOUD_URL ?? DEFAULT_CLOUD_URL,
  );
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const callback = await callbackServer(state, dependencies.timeoutMs ?? LOGIN_TIMEOUT_MS);
  const authorizeUrl = new URL('/cli/authorize', origin);
  authorizeUrl.searchParams.set('redirect_uri', callback.redirectUri);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);

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
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error('Cloud rejected the CLI authorization code. Run `hypequery login` again.');
    }
    const credential = tokenResponse(body, origin);
    await (dependencies.saveCredential ?? saveCloudCredential)(credential);
    logger.success('Logged in to Hypequery Cloud');
    logger.info(`Credential expires ${new Date(credential.expiresAt).toLocaleString()}`);
  } finally {
    callback.close();
  }
}

export async function logoutCommand(dependencies: LogoutDependencies = {}) {
  const load = dependencies.loadCredential ?? loadCloudCredential;
  const remove = dependencies.deleteCredential ?? deleteCloudCredential;
  const credential = await load();
  if (!credential) {
    logger.info('You are not logged in to Hypequery Cloud.');
    return;
  }
  try {
    const request = dependencies.fetch ?? fetch;
    const response = await request(new URL('/api/cli/token', credential.cloudUrl), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${credential.token}` },
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Cloud returned HTTP ${response.status}.`);
  } catch {
    logger.warn('Cloud could not be reached; the local credential was removed and the token will expire automatically.');
  }
  await remove();
  logger.success('Logged out of Hypequery Cloud');
}
