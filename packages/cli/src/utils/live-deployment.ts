import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS,
  validateProtocolDeploymentReleaseTarget,
  type ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_RESPONSE_BYTES = Math.ceil(
  DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxSourceBytes * 1.4,
) + 1_000_000;

export type LiveDeploymentSourceFile = {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
};

export type LiveDeploymentSource = {
  readonly entrypoint: string;
  readonly files: readonly LiveDeploymentSourceFile[];
  readonly revision?: {
    readonly kind: 'git';
    readonly commit: string;
    readonly branch?: string;
    readonly dirty: boolean;
  };
};

export type LiveDeployment = {
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly active: null | {
    readonly revision: string;
    readonly releaseIdentity: string;
    readonly activatedAt: string;
    readonly restored: boolean;
    readonly hasSource: boolean;
    readonly source?: LiveDeploymentSource;
  };
};

export type LiveDeploymentFetch = typeof fetch;

function liveUrl(
  endpoint: string,
  target: ProtocolDeploymentReleaseTarget,
  resource: 'state' | 'source',
): string | undefined {
  const url = new URL(endpoint);
  if (!/\/v1\/deployments\/submissions\/?$/.test(url.pathname)) {
    return undefined;
  }
  const loopbackHttp = url.protocol === 'http:'
    && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if ((url.protocol !== 'https:' && !loopbackHttp)
    || url.username
    || url.password
    || url.hash) {
    throw new Error('The deployment endpoint cannot be used to read live state safely.');
  }
  url.pathname = `/v1/deployments/targets/${encodeURIComponent(target.project)}`
    + `/${encodeURIComponent(target.environment)}/${resource}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function safePath(input: unknown): input is string {
  return typeof input === 'string'
    && input.length > 0
    && input.length <= 1024
    && input.split(path.sep).join('/') === input
    && !path.isAbsolute(input)
    && input.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}

function decodeFile(input: unknown): LiveDeploymentSourceFile {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Cloud returned an invalid live source snapshot.');
  }
  const value = input as Record<string, unknown>;
  if (!safePath(value.path)
    || typeof value.sha256 !== 'string'
    || !SHA256_PATTERN.test(value.sha256)
    || !Number.isSafeInteger(value.byteLength)
    || (value.byteLength as number) < 0
    || (value.byteLength as number)
      > DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxSourceFileBytes
    || typeof value.contentsBase64 !== 'string'
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value.contentsBase64,
    )) {
    throw new Error('Cloud returned an invalid live source snapshot.');
  }
  const bytes = Buffer.from(value.contentsBase64, 'base64');
  if (bytes.byteLength !== value.byteLength
    || createHash('sha256').update(bytes).digest('hex') !== value.sha256) {
    throw new Error('Cloud returned a corrupt live source snapshot.');
  }
  return Object.freeze({ path: value.path, sha256: value.sha256, bytes });
}

function parseSource(input: unknown): LiveDeploymentSource {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Cloud returned an invalid live source snapshot.');
  }
  const value = input as Record<string, unknown>;
  if (!safePath(value.entrypoint) || !Array.isArray(value.files)
    || value.files.length < 1
    || value.files.length > DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxSourceFiles) {
    throw new Error('Cloud returned an invalid live source snapshot.');
  }
  const files = value.files.map(decodeFile);
  const paths = new Set<string>();
  let total = 0;
  for (const file of files) {
    const folded = file.path.toLowerCase();
    if (paths.has(folded)) throw new Error('Cloud returned duplicate live source paths.');
    paths.add(folded);
    total += file.bytes.byteLength;
  }
  if (total > DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxSourceBytes
    || !files.some(file => file.path === value.entrypoint)) {
    throw new Error('Cloud returned an invalid live source snapshot.');
  }
  let revision: LiveDeploymentSource['revision'];
  if (value.revision !== undefined) {
    if (typeof value.revision !== 'object' || value.revision === null
      || Array.isArray(value.revision)) {
      throw new Error('Cloud returned an invalid live source revision.');
    }
    const candidate = value.revision as Record<string, unknown>;
    if (candidate.kind !== 'git'
      || typeof candidate.commit !== 'string'
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(candidate.commit)
      || typeof candidate.dirty !== 'boolean'
      || (candidate.branch !== undefined && typeof candidate.branch !== 'string')) {
      throw new Error('Cloud returned an invalid live source revision.');
    }
    revision = {
      kind: 'git',
      commit: candidate.commit,
      dirty: candidate.dirty,
      ...(candidate.branch !== undefined ? { branch: candidate.branch } : {}),
    };
  }
  return Object.freeze({
    entrypoint: value.entrypoint,
    files: Object.freeze(files),
    ...(revision ? { revision: Object.freeze(revision) } : {}),
  });
}

function parseResponse(
  input: unknown,
  expectedTarget: ProtocolDeploymentReleaseTarget,
): LiveDeployment {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Cloud returned an invalid live deployment response.');
  }
  const value = input as Record<string, unknown>;
  let target: ProtocolDeploymentReleaseTarget;
  try {
    target = validateProtocolDeploymentReleaseTarget(value.target);
  } catch {
    throw new Error('Cloud returned an invalid live deployment target.');
  }
  if (value.kind !== 'hypequery-live-deployment' || value.version !== 1
    || target.project !== expectedTarget.project
    || target.environment !== expectedTarget.environment) {
    throw new Error('Cloud returned a mismatched live deployment response.');
  }
  if (value.active === null) return Object.freeze({ target, active: null });
  if (typeof value.active !== 'object' || Array.isArray(value.active)) {
    throw new Error('Cloud returned an invalid live deployment response.');
  }
  const active = value.active as Record<string, unknown>;
  if (typeof active.revision !== 'string' || !SHA256_PATTERN.test(active.revision)
    || typeof active.releaseIdentity !== 'string'
    || !SHA256_PATTERN.test(active.releaseIdentity)
    || typeof active.activatedAt !== 'string'
    || !Number.isFinite(Date.parse(active.activatedAt))
    || typeof active.restored !== 'boolean'
    || typeof active.hasSource !== 'boolean'
    || (active.source !== undefined && !active.hasSource)) {
    throw new Error('Cloud returned an invalid live deployment response.');
  }
  return Object.freeze({
    target,
    active: Object.freeze({
      revision: active.revision,
      releaseIdentity: active.releaseIdentity,
      activatedAt: active.activatedAt,
      restored: active.restored,
      hasSource: active.hasSource,
      ...(active.source !== undefined ? { source: parseSource(active.source) } : {}),
    }),
  });
}

async function errorMessage(response: Response) {
  try {
    const input = await response.json() as {
      error?: { code?: unknown; message?: unknown };
    };
    const code = typeof input.error?.code === 'string' ? `${input.error.code}: ` : '';
    const message = typeof input.error?.message === 'string'
      ? input.error.message
      : response.statusText;
    return `${code}${message}`;
  } catch {
    return response.statusText;
  }
}

export async function fetchLiveDeployment(input: {
  readonly endpoint: string;
  readonly token: string;
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly resource: 'state' | 'source';
  readonly fetch?: LiveDeploymentFetch;
}): Promise<LiveDeployment | undefined> {
  if (input.token.length < 1 || input.token.length > 4096
    || input.token.trim() !== input.token
    || [...input.token].some(character => {
      const code = character.charCodeAt(0);
      return code < 0x21 || code > 0x7e;
    })) {
    throw new Error('The deployment credential contains invalid characters or length.');
  }
  const request = input.fetch ?? fetch;
  const url = liveUrl(input.endpoint, input.target, input.resource);
  if (!url) return undefined;
  const response = await request(url, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${input.token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (input.resource === 'state' && response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `Could not read the live deployment (${response.status}): ${await errorMessage(response)}`,
    );
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error('Cloud returned an oversized live deployment response.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('Cloud returned an oversized live deployment response.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Cloud returned an invalid live deployment response.');
  }
  return parseResponse(parsed, input.target);
}
