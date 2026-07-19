import {
  validateProtocolDeploymentReleaseTarget,
  type ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';
import {
  DeploymentActivationError,
  type DeploymentActivationRecord,
  type DeploymentActivationRegistry,
} from './activation.js';
import {
  resolveDeploymentControlPlaneLimits,
  type DeploymentControlPlaneLimits,
} from './control-plane-limits.js';
import type {
  DeploymentAuthenticator,
  DeploymentIntake,
  DeploymentIntakeRequest,
  DeploymentIntakeResponse,
} from './types.js';

const IDENTITY_PATTERN = /^[0-9a-f]{64}$/;
const JSON_CONTENT_TYPE = /^application\/json(?:;\s*charset=utf-8)?$/i;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export type DeploymentControlPlaneAction =
  | 'activate'
  | 'read-current-activation'
  | 'read-activation-history';

export interface DeploymentControlPlaneAuthorizationInput<Principal> {
  readonly principal: Principal;
  readonly action: DeploymentControlPlaneAction;
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly signal?: AbortSignal;
}

export interface DeploymentControlPlaneAuthorizer<Principal> {
  authorize(input: DeploymentControlPlaneAuthorizationInput<Principal>): Promise<boolean>;
}

export interface DeploymentControlPlaneRequest extends DeploymentIntakeRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** Set by transport adapters without consuming the request stream. */
  readonly hasBody?: boolean;
}

export type DeploymentControlPlaneResponse = DeploymentIntakeResponse;

export interface DeploymentControlPlane {
  handle(request: DeploymentControlPlaneRequest): Promise<DeploymentControlPlaneResponse>;
}

export interface DeploymentControlPlaneOptions<Principal> {
  readonly intake: DeploymentIntake;
  readonly activations: DeploymentActivationRegistry;
  readonly authenticator: DeploymentAuthenticator<Principal>;
  readonly authorizer: DeploymentControlPlaneAuthorizer<Principal>;
  readonly limits?: Partial<DeploymentControlPlaneLimits>;
  /** Called after a successful activation has been durably committed. */
  readonly onActivation?: (
    activation: DeploymentActivationRecord,
  ) => void | Promise<void>;
  readonly onBackgroundError?: (error: unknown) => void;
}

export type DeploymentControlPlaneErrorCode =
  | 'HQ_CONTROL_BAD_REQUEST'
  | 'HQ_CONTROL_UNAUTHENTICATED'
  | 'HQ_CONTROL_FORBIDDEN'
  | 'HQ_CONTROL_NOT_FOUND'
  | 'HQ_CONTROL_METHOD_NOT_ALLOWED'
  | 'HQ_CONTROL_TOO_LARGE'
  | 'HQ_CONTROL_RELEASE_NOT_FOUND'
  | 'HQ_CONTROL_RELEASE_UNAVAILABLE'
  | 'HQ_CONTROL_INTERNAL';

const ERROR_STATUS: Readonly<Record<DeploymentControlPlaneErrorCode, number>> = Object.freeze({
  HQ_CONTROL_BAD_REQUEST: 400,
  HQ_CONTROL_UNAUTHENTICATED: 401,
  HQ_CONTROL_FORBIDDEN: 403,
  HQ_CONTROL_NOT_FOUND: 404,
  HQ_CONTROL_METHOD_NOT_ALLOWED: 405,
  HQ_CONTROL_TOO_LARGE: 413,
  HQ_CONTROL_RELEASE_NOT_FOUND: 404,
  HQ_CONTROL_RELEASE_UNAVAILABLE: 503,
  HQ_CONTROL_INTERNAL: 500,
});

class ControlPlaneError extends Error {
  readonly code: DeploymentControlPlaneErrorCode;
  readonly status: number;
  readonly expose: boolean;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    code: DeploymentControlPlaneErrorCode,
    message: string,
    options: {
      readonly expose?: boolean;
      readonly cause?: unknown;
      readonly headers?: Readonly<Record<string, string>>;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DeploymentControlPlaneError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.expose = options.expose ?? this.status < 500;
    this.headers = Object.freeze({ ...options.headers });
  }
}

interface ActivationBody {
  readonly releaseIdentity: string;
  readonly expectedRevision: string | null;
}

interface ParsedRoute {
  readonly kind: 'submission' | 'activation' | 'history';
  readonly target?: ProtocolDeploymentReleaseTarget;
}

function requestHeader(
  headers: Readonly<Record<string, string | undefined>>,
  expectedName: string,
): string | undefined {
  const values = Object.entries(headers)
    .filter(([name, value]) => value !== undefined && name.toLowerCase() === expectedName)
    .map(([, value]) => value!);
  if (values.length > 1) {
    throw new ControlPlaneError('HQ_CONTROL_BAD_REQUEST', `Duplicate ${expectedName} header.`);
  }
  return values[0];
}

function bearerToken(headers: Readonly<Record<string, string | undefined>>): string {
  const authorization = requestHeader(headers, 'authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (token.length < 1 || token.length > 4096 || token.trim() !== token
    || [...token].some(character => {
      const code = character.charCodeAt(0);
      return code < 0x21 || code > 0x7e;
    })) {
    throw new ControlPlaneError(
      'HQ_CONTROL_UNAUTHENTICATED',
      'A valid bearer credential is required.',
      { headers: { 'www-authenticate': 'Bearer' } },
    );
  }
  return token;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): DeploymentControlPlaneResponse {
  const encoded = `${JSON.stringify(body)}\n`;
  return Object.freeze({
    status,
    headers: Object.freeze({
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(encoded)),
      'cache-control': 'no-store',
      ...headers,
    }),
    body: encoded,
  });
}

function sanitizeMessage(input: string): string {
  return [...input].map(character => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f ? ' ' : character;
  }).join('').slice(0, 1024).trim() || 'The deployment control-plane request was rejected.';
}

function errorResponse(error: unknown): DeploymentControlPlaneResponse {
  const value = error instanceof ControlPlaneError
    ? error
    : new ControlPlaneError(
      'HQ_CONTROL_INTERNAL',
      'The deployment control-plane request could not be processed.',
      { expose: false, cause: error },
    );
  return jsonResponse(value.status, {
    error: {
      code: value.code,
      message: sanitizeMessage(value.expose
        ? value.message
        : 'The deployment control-plane request could not be processed.'),
    },
  }, value.headers);
}

function decodeTargetSegment(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch (error) {
    throw new ControlPlaneError(
      'HQ_CONTROL_BAD_REQUEST',
      'Deployment target path encoding is invalid.',
      { cause: error },
    );
  }
}

function validatedTarget(project: string, environment: string): ProtocolDeploymentReleaseTarget {
  try {
    return validateProtocolDeploymentReleaseTarget({
      project: decodeTargetSegment(project),
      environment: decodeTargetSegment(environment),
    });
  } catch (error) {
    if (error instanceof ControlPlaneError) throw error;
    throw new ControlPlaneError(
      'HQ_CONTROL_BAD_REQUEST',
      'Deployment target path is invalid.',
      { cause: error },
    );
  }
}

function parseRoute(path: string): ParsedRoute | undefined {
  if (path === '/v1/deployments/submissions') return Object.freeze({ kind: 'submission' });
  const segments = path.split('/');
  if (segments.length !== 7 || segments[0] !== '' || segments[1] !== 'v1'
    || segments[2] !== 'deployments' || segments[3] !== 'targets') return undefined;
  if (segments[6] !== 'activation' && segments[6] !== 'activations') return undefined;
  const target = validatedTarget(segments[4]!, segments[5]!);
  if (segments[6] === 'activation') return Object.freeze({ kind: 'activation', target });
  if (segments[6] === 'activations') return Object.freeze({ kind: 'history', target });
  return undefined;
}

function requireMethod(method: string, ...expected: readonly string[]): void {
  if (!expected.includes(method)) {
    const allowed = expected.join(', ');
    throw new ControlPlaneError(
      'HQ_CONTROL_METHOD_NOT_ALLOWED',
      `This deployment control-plane route requires ${allowed}.`,
      { headers: { allow: allowed } },
    );
  }
}

function requireNoQuery(request: DeploymentControlPlaneRequest): void {
  if (request.query && Object.keys(request.query).length > 0) {
    throw new ControlPlaneError(
      'HQ_CONTROL_BAD_REQUEST',
      'This deployment control-plane route does not accept query parameters.',
    );
  }
}

function requireNoBody(request: DeploymentControlPlaneRequest): void {
  const length = requestHeader(request.headers, 'content-length');
  const transferEncoding = requestHeader(request.headers, 'transfer-encoding');
  if (request.hasBody || transferEncoding !== undefined || (length !== undefined && length !== '0')) {
    throw new ControlPlaneError(
      'HQ_CONTROL_BAD_REQUEST',
      'This deployment control-plane route does not accept a request body.',
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ControlPlaneError(
      'HQ_CONTROL_BAD_REQUEST',
      'The deployment control-plane request was aborted.',
      { cause: signal.reason },
    );
  }
}

async function readBoundedBody(
  request: DeploymentControlPlaneRequest,
  maximum: number,
): Promise<Buffer> {
  const declared = requestHeader(request.headers, 'content-length');
  let declaredLength: number | undefined;
  if (declared !== undefined) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declared)) {
      throw new ControlPlaneError(
        'HQ_CONTROL_BAD_REQUEST',
        'Content-Length must be a non-negative decimal integer.',
      );
    }
    declaredLength = Number(declared);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maximum) {
      throw new ControlPlaneError(
        'HQ_CONTROL_TOO_LARGE',
        'The activation request exceeds its byte limit.',
      );
    }
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of request.body) {
      throwIfAborted(request.signal);
      if (!(chunk instanceof Uint8Array)) {
        throw new ControlPlaneError(
          'HQ_CONTROL_BAD_REQUEST',
          'The activation request body yielded a non-byte chunk.',
        );
      }
      total += chunk.byteLength;
      if (total > maximum) {
        throw new ControlPlaneError(
          'HQ_CONTROL_TOO_LARGE',
          'The activation request exceeds its byte limit.',
        );
      }
      if (declaredLength !== undefined && total > declaredLength) {
        throw new ControlPlaneError(
          'HQ_CONTROL_BAD_REQUEST',
          'The activation request body does not match Content-Length.',
        );
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error instanceof ControlPlaneError) throw error;
    throw new ControlPlaneError(
      'HQ_CONTROL_BAD_REQUEST',
      'The activation request body could not be read.',
      { cause: error },
    );
  }
  throwIfAborted(request.signal);
  if (declaredLength !== undefined && total !== declaredLength) {
    throw new ControlPlaneError(
      'HQ_CONTROL_BAD_REQUEST',
      'The activation request body does not match Content-Length.',
    );
  }
  return Buffer.concat(chunks, total);
}

function parseActivationBody(bytes: Uint8Array): ActivationBody {
  let input: unknown;
  try {
    input = JSON.parse(textDecoder.decode(bytes));
  } catch (error) {
    throw new ControlPlaneError(
      'HQ_CONTROL_BAD_REQUEST',
      'The activation request must be valid UTF-8 JSON.',
      { cause: error },
    );
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ControlPlaneError('HQ_CONTROL_BAD_REQUEST', 'The activation request is invalid.');
  }
  const value = input as Record<string, unknown>;
  const expected = ['expectedRevision', 'kind', 'releaseIdentity', 'version'];
  if (Object.keys(value).sort().join('\0') !== expected.join('\0')
    || value.kind !== 'hypequery-deployment-activation-request' || value.version !== 1
    || typeof value.releaseIdentity !== 'string'
    || !IDENTITY_PATTERN.test(value.releaseIdentity)
    || (value.expectedRevision !== null
      && (typeof value.expectedRevision !== 'string'
        || !IDENTITY_PATTERN.test(value.expectedRevision)))) {
    throw new ControlPlaneError('HQ_CONTROL_BAD_REQUEST', 'The activation request is invalid.');
  }
  return Object.freeze({
    releaseIdentity: value.releaseIdentity,
    expectedRevision: value.expectedRevision as string | null,
  });
}

function activationError(error: DeploymentActivationError): never {
  switch (error.code) {
    case 'HQ_DEPLOYMENT_ACTIVATION_INVALID_REQUEST':
      throw new ControlPlaneError(
        'HQ_CONTROL_BAD_REQUEST',
        'The deployment activation request is invalid.',
        { cause: error },
      );
    case 'HQ_DEPLOYMENT_ACTIVATION_TARGET_MISMATCH':
      throw new ControlPlaneError(
        'HQ_CONTROL_BAD_REQUEST',
        'The deployment release does not match the requested target.',
        { cause: error },
      );
    case 'HQ_DEPLOYMENT_ACTIVATION_RELEASE_NOT_FOUND':
      throw new ControlPlaneError(
        'HQ_CONTROL_RELEASE_NOT_FOUND',
        'The deployment release was not found.',
        { cause: error },
      );
    case 'HQ_DEPLOYMENT_ACTIVATION_RELEASE_UNAVAILABLE':
      throw new ControlPlaneError(
        'HQ_CONTROL_RELEASE_UNAVAILABLE',
        'The deployment release is temporarily unavailable.',
        { cause: error },
      );
    default:
      throw new ControlPlaneError(
        'HQ_CONTROL_INTERNAL',
        'The deployment activation state could not be processed.',
        { expose: false, cause: error },
      );
  }
}

async function activationCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DeploymentActivationError) activationError(error);
    throw error;
  }
}

function activationResponse(
  status: 'activated' | 'already-active',
  activation: DeploymentActivationRecord,
): DeploymentControlPlaneResponse {
  return jsonResponse(status === 'activated' ? 201 : 200, {
    kind: 'hypequery-deployment-activation-response',
    version: 1,
    status,
    activation,
  });
}

function validatedHistoryQuery(
  query: Readonly<Record<string, string | readonly string[] | undefined>> | undefined,
  maximum: number,
): { readonly limit: number; readonly before?: string } {
  const values = query ?? {};
  if (Object.keys(values).some(key => key !== 'limit' && key !== 'before')) {
    throw new ControlPlaneError('HQ_CONTROL_BAD_REQUEST', 'History query parameters are invalid.');
  }
  const limitInput = values.limit;
  if (limitInput !== undefined && typeof limitInput !== 'string') {
    throw new ControlPlaneError('HQ_CONTROL_BAD_REQUEST', 'History limit is invalid.');
  }
  const limit = limitInput === undefined ? maximum : Number(limitInput);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum
    || (limitInput !== undefined && String(limit) !== limitInput)) {
    throw new ControlPlaneError('HQ_CONTROL_BAD_REQUEST', 'History limit is invalid.');
  }
  const before = values.before;
  if (before !== undefined && typeof before !== 'string') {
    throw new ControlPlaneError('HQ_CONTROL_BAD_REQUEST', 'History cursor is invalid.');
  }
  if (before !== undefined) {
    if (!IDENTITY_PATTERN.test(before)) {
      throw new ControlPlaneError('HQ_CONTROL_BAD_REQUEST', 'History cursor is invalid.');
    }
  }
  return Object.freeze({ limit, ...(before === undefined ? {} : { before }) });
}

export function createDeploymentControlPlane<Principal>(
  options: DeploymentControlPlaneOptions<Principal>,
): DeploymentControlPlane {
  const limits = resolveDeploymentControlPlaneLimits(options.limits);

  function reportBackgroundError(error: unknown): void {
    try {
      options.onBackgroundError?.(error);
    } catch {
      // Diagnostics cannot change the result of an already-durable activation.
    }
  }

  function notifyActivation(activation: DeploymentActivationRecord): void {
    try {
      const operation = options.onActivation?.(activation);
      if (operation) void Promise.resolve(operation).catch(reportBackgroundError);
    } catch (error) {
      reportBackgroundError(error);
    }
  }

  async function authenticateAndAuthorize(
    request: DeploymentControlPlaneRequest,
    action: DeploymentControlPlaneAction,
    target: ProtocolDeploymentReleaseTarget,
  ): Promise<void> {
    throwIfAborted(request.signal);
    const token = bearerToken(request.headers);
    const principal = await options.authenticator.authenticate({ token, signal: request.signal });
    if (principal === null) {
      throw new ControlPlaneError(
        'HQ_CONTROL_UNAUTHENTICATED',
        'The bearer credential is invalid.',
        { headers: { 'www-authenticate': 'Bearer' } },
      );
    }
    throwIfAborted(request.signal);
    const allowed = await options.authorizer.authorize({
      principal,
      action,
      target,
      signal: request.signal,
    });
    if (!allowed) {
      throw new ControlPlaneError(
        'HQ_CONTROL_FORBIDDEN',
        'The caller is not authorized for the deployment target.',
      );
    }
    throwIfAborted(request.signal);
  }

  async function process(
    request: DeploymentControlPlaneRequest,
  ): Promise<DeploymentControlPlaneResponse> {
    const method = request.method.toUpperCase();
    const route = parseRoute(request.path);
    if (!route) {
      throw new ControlPlaneError('HQ_CONTROL_NOT_FOUND', 'Deployment route not found.');
    }
    if (route.kind === 'submission') {
      requireMethod(method, 'POST');
      requireNoQuery(request);
      return options.intake.handle(request);
    }
    const target = route.target!;
    if (route.kind === 'activation') {
      if (method === 'GET') {
        requireNoQuery(request);
        requireNoBody(request);
        await authenticateAndAuthorize(request, 'read-current-activation', target);
        const current = await activationCall(() => options.activations.current(target));
        return jsonResponse(200, {
          kind: 'hypequery-deployment-current-activation',
          version: 1,
          target,
          activation: current ?? null,
        });
      }
      requireMethod(method, 'GET', 'PUT');
      requireNoQuery(request);
      await authenticateAndAuthorize(request, 'activate', target);
      const contentType = requestHeader(request.headers, 'content-type');
      if (!contentType || !JSON_CONTENT_TYPE.test(contentType)) {
        throw new ControlPlaneError(
          'HQ_CONTROL_BAD_REQUEST',
          'Activation requests require application/json with UTF-8 encoding.',
        );
      }
      const body = parseActivationBody(
        await readBoundedBody(request, limits.maxActivationRequestBytes),
      );
      const result = await activationCall(() => options.activations.activate({
        target,
        releaseIdentity: body.releaseIdentity,
        expectedRevision: body.expectedRevision,
      }));
      if (result.status === 'conflict') {
        return jsonResponse(409, {
          kind: 'hypequery-deployment-activation-response',
          version: 1,
          status: 'conflict',
          current: result.current,
        });
      }
      notifyActivation(result.activation);
      return activationResponse(result.status, result.activation);
    }
    requireMethod(method, 'GET');
    requireNoBody(request);
    await authenticateAndAuthorize(request, 'read-activation-history', target);
    const historyQuery = validatedHistoryQuery(request.query, limits.maxHistoryPageSize);
    const page = await activationCall(() => (
      options.activations.historyPage(target, historyQuery)
    ));
    return jsonResponse(200, {
      kind: 'hypequery-deployment-activation-history',
      version: 1,
      target,
      activations: page.activations,
      nextBefore: page.nextBefore,
    });
  }

  return Object.freeze({
    async handle(request: DeploymentControlPlaneRequest): Promise<DeploymentControlPlaneResponse> {
      try {
        return await process(request);
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
}
