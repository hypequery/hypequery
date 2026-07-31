import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import open from 'open';
import { validateProtocolDeploymentReleaseTarget } from '@hypequery/protocol';

import {
  CLOUD_DEPLOYMENT_SCOPE,
  deleteCloudCredential,
  loadCloudCredential,
  normalizeCloudDeploymentEndpoint,
  normalizeCloudOrigin,
  saveCloudCredential,
  type StoredCloudCredential,
} from '../utils/cloud-credential-store.js';
import { currentGitBranch } from '../utils/git-branch.js';
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
  /** Commander sets this to false for `--no-branch`. */
  readonly branch?: boolean;
  /** Stable Cloud deployment target. This always takes precedence over Git branch context. */
  readonly environment?: string;
}

export interface LoginDependencies {
  readonly fetch?: typeof fetch;
  readonly getGitBranch?: () => Promise<string | null>;
  readonly openBrowser?: (url: string) => Promise<unknown>;
  readonly now?: () => number;
  readonly requestTimeoutMs?: number;
  readonly saveCredential?: typeof saveCloudCredential;
  readonly timeoutMs?: number;
}

/**
 * Branch names carry internal detail (customer names, embargoed identifiers),
 * so both an explicit `--no-branch` and the environment variable suppress the
 * parameter. The flag wins because it is the more specific signal.
 */
function branchContextEnabled(options: LoginOptions): boolean {
  if (options.branch === false) return false;
  const configured = process.env.HYPEQUERY_CLI_SEND_BRANCH?.trim().toLowerCase();
  return configured !== '0' && configured !== 'false' && configured !== 'no';
}

export interface LogoutDependencies {
  readonly fetch?: typeof fetch;
  readonly loadCredential?: typeof loadCloudCredential;
  readonly deleteCredential?: typeof deleteCloudCredential;
  readonly requestTimeoutMs?: number;
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
    || value.scope !== CLOUD_DEPLOYMENT_SCOPE
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
  // Resolve branch context before the loopback listener opens: shelling out to
  // git should not hold a server socket, and a caller-supplied resolver that
  // rejects must not leak one.
  const branch = branchContextEnabled(options)
    ? await (dependencies.getGitBranch ?? currentGitBranch)()
    : null;
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
  if (branch) authorizeUrl.searchParams.set('branch', branch);
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
    // Cloud resolves the target, and branch context only expresses intent, so
    // print what was actually issued rather than what was requested.
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
