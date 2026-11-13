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
import { emitResult } from '../utils/machine-output.js';
import { CliError, cloudHttpError } from '../utils/cli-error.js';
import { parseCloudErrorBody } from '../utils/cloud-error-body.js';
import { isUnattended } from '../utils/input-mode.js';
import { parseCapabilityList } from '../utils/capability-list.js';
import { DEFAULT_CLOUD_URL } from '../utils/cloud-origin.js';
import { revokeCloudToken } from '../utils/cloud-token-revocation.js';
import {
  pollDeviceAuthorization,
  startDeviceAuthorization,
} from '../utils/device-sign-in.js';
import { managementCredentialFromResponse } from '../utils/management-token-response.js';
import {
  deleteManagementCredentials,
  loadAllManagementCredentials,
  saveManagementCredential,
  type StoredManagementCredential,
} from '../utils/management-token-store.js';
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
  /** Sign in with a user code approved in any browser (RFC 8628), for machines without one. */
  readonly device?: boolean;
  /** With --device: limit the management token to this Cloud project (slug). */
  readonly project?: string;
  /** With --device: cap the management token to these capabilities (comma-separated). */
  readonly capabilities?: string;
}

export interface LoginDependencies {
  readonly fetch?: typeof fetch;
  readonly openBrowser?: (url: string) => Promise<unknown>;
  readonly now?: () => number;
  readonly requestTimeoutMs?: number;
  readonly saveCredential?: typeof saveCloudCredential;
  readonly saveManagementCredential?: typeof saveManagementCredential;
  readonly deleteManagementCredentials?: typeof deleteManagementCredentials;
  /** Device sign-in's wait between polls. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Whether a person is at this terminal, so device sign-in may open a browser. */
  readonly isInteractive?: () => boolean;
  readonly timeoutMs?: number;
}

export interface LogoutDependencies {
  readonly fetch?: typeof fetch;
  readonly loadCredential?: typeof loadCloudCredential;
  readonly deleteCredential?: typeof deleteCloudCredential;
  readonly loadManagementCredentials?: typeof loadAllManagementCredentials;
  readonly deleteManagementCredentials?: typeof deleteManagementCredentials;
  readonly env?: Readonly<Record<string, string | undefined>>;
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
      reject?.(new CliError('CLOUD_AUTHORIZATION_DECLINED', 'Cloud authorization was not completed.', {
        exitClass: 'auth',
        hint: 'Run `hypequery login` again and approve the request in the browser.',
      }));
    }
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, rejectListen) => {
    server.once('listening', resolve);
    server.once('error', rejectListen);
  });
  const address = server.address() as AddressInfo;
  const timer = setTimeout(() => {
    reject?.(new CliError('CLOUD_AUTHORIZATION_TIMED_OUT', 'CLI authorization timed out. Run `hypequery login` again.', {
      exitClass: 'auth',
      hint: 'Run `hypequery login` again and approve the request in the browser within 5 minutes.',
    }));
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

function capabilityCap(options: LoginOptions): string[] | undefined {
  return options.capabilities === undefined ? undefined : parseCapabilityList(options.capabilities);
}

function defaultIsInteractive() {
  return process.stdin.isTTY === true && process.stderr.isTTY === true && !isUnattended();
}

/**
 * Browser sign-in also asks for a management token (AG-04). A Cloud without
 * them ignores the request and returns only the deploy credential; then any
 * older management token for this origin is dropped, so it can't outrank the
 * sign-in that just happened.
 */
async function storeBrowserManagementToken(
  body: unknown,
  origin: string,
  now: number,
  dependencies: LoginDependencies,
): Promise<StoredManagementCredential | null> {
  let management: StoredManagementCredential | null = null;
  try {
    management = managementCredentialFromResponse(body, { origin, now, signedInWith: 'browser' });
  } catch {
    logger.warn('Cloud returned a management token the CLI could not use; continuing with the deploy credential.');
  }
  if (management) {
    try {
      const saved = await (dependencies.saveManagementCredential ?? saveManagementCredential)(management);
      if (saved.storage === 'file') {
        logger.warn(`The operating-system credential vault is unavailable, so the management token is stored in ${saved.path} (readable only by you).`);
      }
      return management;
    } catch {
      logger.warn('The management token could not be stored; continuing with the deploy credential.');
    }
  }
  await (dependencies.deleteManagementCredentials ?? deleteManagementCredentials)({ cloudUrl: origin })
    .catch(() => undefined);
  return null;
}

/**
 * `hypequery login --device` (AG-05, RFC 8628): print a user code, let a
 * person approve it in any browser, and poll for a management token. Works
 * over SSH, in containers and for coding agents; the browser opens only when
 * a person is at this terminal.
 */
async function deviceLogin(
  origin: string,
  options: LoginOptions,
  dependencies: LoginDependencies,
) {
  if (options.environment !== undefined) {
    throw new CliError('USAGE', '--environment applies only to browser sign-in, not --device.', {
      hint: 'Drop --environment; pass --project and --environment to deploy commands instead.',
    });
  }
  const capabilities = capabilityCap(options);
  const flow = {
    fetch: dependencies.fetch,
    now: dependencies.now,
    sleep: dependencies.sleep,
    requestTimeoutMs: dependencies.requestTimeoutMs,
  };
  const authorization = await startDeviceAuthorization({
    origin,
    ...(options.project !== undefined ? { project: options.project } : {}),
    ...(capabilities ? { capabilities } : {}),
  }, flow);
  const minutes = Math.max(1, Math.round((authorization.expiresAt - (dependencies.now ?? Date.now)()) / 60_000));
  logger.info(`To sign in to Hypequery Cloud, open ${authorization.verificationUri} and enter the code: ${authorization.userCode}`);
  if (authorization.verificationUriComplete) {
    logger.info(`Or open this link, which fills in the code: ${authorization.verificationUriComplete}`);
  }
  logger.info(`The code expires in ${minutes} minute${minutes === 1 ? '' : 's'}. Waiting for approval…`);
  if ((dependencies.isInteractive ?? defaultIsInteractive)()) {
    await (dependencies.openBrowser ?? open)(authorization.verificationUriComplete ?? authorization.verificationUri)
      .catch(() => undefined);
  }
  const body = await pollDeviceAuthorization(origin, authorization, flow);
  const credential = managementCredentialFromResponse(body, {
    origin,
    now: (dependencies.now ?? Date.now)(),
    signedInWith: 'device',
  });
  if (!credential) throw new Error('Cloud returned an invalid device sign-in response.');
  const saved = await (dependencies.saveManagementCredential ?? saveManagementCredential)(credential);
  logger.success('Logged in to Hypequery Cloud');
  if (saved.storage === 'file') {
    logger.warn(`The operating-system credential vault is unavailable, so the token is stored in ${saved.path} (readable only by you).`);
  }
  if (credential.project) {
    logger.info(credential.projectLimited
      ? `Limited to project ${credential.project}`
      : `Default project ${credential.project}`);
  }
  if (credential.capabilities) logger.info(`Capabilities: ${credential.capabilities.join(', ')}`);
  logger.info(`Credential expires ${new Date(credential.expiresAt).toLocaleString()}`);
  if (!credential.target) {
    logger.info('Deploy commands need --project and --environment until Cloud names a target for this sign-in.');
  }
  emitResult({
    signedIn: true,
    method: 'device',
    cloudUrl: origin,
    organizationId: credential.organizationId ?? null,
    project: credential.project ?? null,
    projectLimited: credential.projectLimited,
    capabilities: credential.capabilities ?? null,
    target: credential.target ?? null,
    expiresAt: credential.expiresAt,
    storage: saved.storage,
  });
}

export async function loginCommand(
  options: LoginOptions = {},
  dependencies: LoginDependencies = {},
) {
  const origin = normalizeCloudOrigin(
    options.cloudUrl ?? process.env.HYPEQUERY_CLOUD_URL ?? DEFAULT_CLOUD_URL,
  );
  if (options.device) {
    await deviceLogin(origin, options, dependencies);
    return;
  }
  if (options.project !== undefined || options.capabilities !== undefined) {
    throw new CliError('USAGE', '--project and --capabilities apply only with --device.', {
      hint: 'Add --device, or drop --project and --capabilities.',
    });
  }
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
  if (isUnattended()) {
    // Browser sign-in needs a person; with --no-input or in CI it would only
    // wait out the timeout.
    throw new CliError('LOGIN_NEEDS_A_PERSON', '`hypequery login` signs in through a browser, which needs a person, '
      + 'but this run is unattended (--no-input or CI). Use `hypequery login --device` to approve from another '
      + 'device, or set HYPEQUERY_API_TOKEN.', {
      exitClass: 'auth',
      hint: 'Run `hypequery login --device` and approve the code from any browser, or set HYPEQUERY_API_TOKEN for unattended runs.',
    });
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
        // AG-04: also issue a management token. Older Cloud ignores this.
        management_token: true,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(
        dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
      ),
    });
    if (!response.ok) {
      const rejection = await boundedJsonResponse(response).catch(() => null);
      // An invalid or expired authorization code (400) means signing in again.
      throw cloudHttpError(
        response.status === 400 ? 401 : response.status,
        'Cloud rejected the CLI authorization code. Run `hypequery login` again.',
        parseCloudErrorBody(JSON.stringify(rejection ?? {})),
      );
    }
    const body = await boundedJsonResponse(response);
    const now = (dependencies.now ?? Date.now)();
    const credential = tokenResponse(body, origin, now);
    await (dependencies.saveCredential ?? saveCloudCredential)(credential);
    const management = await storeBrowserManagementToken(body, origin, now, dependencies);
    logger.success('Logged in to Hypequery Cloud');
    // Cloud resolves the target, so print what was actually issued rather than
    // what was requested.
    if (credential.target) {
      logger.info(
        `Deployments target ${credential.target.project} / ${credential.target.environment}`,
      );
    }
    logger.info(`Credential expires ${new Date(credential.expiresAt).toLocaleString()}`);
    emitResult({
      signedIn: true,
      target: credential.target ?? null,
      expiresAt: credential.expiresAt,
      managementTokenExpiresAt: management?.expiresAt ?? null,
    });
  } finally {
    callback.close();
  }
}

export async function logoutCommand(dependencies: LogoutDependencies = {}) {
  const load = dependencies.loadCredential ?? loadCloudCredential;
  const remove = dependencies.deleteCredential ?? deleteCloudCredential;
  const env = dependencies.env ?? process.env;
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
  const management = await (dependencies.loadManagementCredentials ?? loadAllManagementCredentials)()
    .catch(() => ({ credentials: [] as StoredManagementCredential[], unreadable: 1 }));
  if (management.unreadable > 0) {
    unreadable = true;
    logger.warn('A stored management token could not be read; removing it without revoking. It will expire automatically.');
  }
  if (env.HYPEQUERY_API_TOKEN) {
    logger.warn('HYPEQUERY_API_TOKEN is set; commands keep using it until it is unset.');
  }
  if (!credential && management.credentials.length === 0 && !unreadable) {
    logger.info('You are not logged in to Hypequery Cloud.');
    emitResult({ signedIn: false, revoked: false });
    return;
  }
  const revocation = { fetch: dependencies.fetch, requestTimeoutMs: dependencies.requestTimeoutMs };
  let unrevoked = false;
  if (credential) {
    unrevoked = !(await revokeCloudToken(credential.cloudUrl, credential.token, revocation)) || unrevoked;
  }
  for (const stored of management.credentials) {
    unrevoked = !(await revokeCloudToken(stored.cloudUrl, stored.token, revocation)) || unrevoked;
  }
  if (unrevoked) {
    logger.warn('Cloud could not be reached; the local credential was removed and the token will expire automatically.');
  }
  await remove();
  await (dependencies.deleteManagementCredentials ?? deleteManagementCredentials)();
  logger.success('Logged out of Hypequery Cloud');
  emitResult({ signedIn: false });
}
