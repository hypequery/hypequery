import { createHash, randomUUID } from 'node:crypto';
import { constants, open } from 'node:fs/promises';
import path from 'node:path';
import type { ReadableStream } from 'node:stream/web';
import {
  prepareProtocolDeploymentBundleManifest,
  prepareProtocolDeploymentReleaseEnvelope,
  type PreparedProtocolDeploymentBundleManifest,
  type PreparedProtocolDeploymentReleaseEnvelope,
} from '@hypequery/protocol';
import {
  DEPLOYMENT_BUNDLE_MANIFEST,
  type VerifiedDeploymentBundle,
} from './deployment-bundle.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export type DeploymentUploadErrorCode =
  | 'HQ_UPLOAD_CONFIGURATION'
  | 'HQ_UPLOAD_IDENTITY_MISMATCH'
  | 'HQ_UPLOAD_BUNDLE_CHANGED'
  | 'HQ_UPLOAD_NETWORK'
  | 'HQ_UPLOAD_REJECTED'
  | 'HQ_UPLOAD_INVALID_RESPONSE';

export class DeploymentUploadError extends Error {
  readonly code: DeploymentUploadErrorCode;
  readonly status?: number;

  constructor(code: DeploymentUploadErrorCode, message: string, status?: number) {
    super(`${code}: ${message}`);
    this.name = 'DeploymentUploadError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export interface DeploymentSubmissionResponse {
  readonly kind: 'hypequery-deployment-submission';
  readonly version: 1;
  readonly status: 'accepted' | 'already-exists';
  readonly releaseIdentity: string;
  readonly bundleIdentity: string;
}

export interface DeploymentHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly body: ReadableStream<Uint8Array> | null;
}

export interface DeploymentFetchInit {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array>;
  readonly duplex: 'half';
  readonly redirect: 'error';
  readonly signal: AbortSignal;
}

export type DeploymentFetch = (
  input: string,
  init: DeploymentFetchInit,
) => Promise<DeploymentHttpResponse>;

export interface HttpDeploymentUploadTransportOptions {
  readonly endpoint: string;
  readonly token: string;
  readonly timeoutMs?: number;
  readonly fetch?: DeploymentFetch;
}

export interface DeploymentUploadTransport {
  submit(
    bundle: VerifiedDeploymentBundle,
    release: PreparedProtocolDeploymentReleaseEnvelope,
  ): Promise<DeploymentSubmissionResponse>;
}

interface BytesPart {
  readonly kind: 'bytes';
  readonly name: string;
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly bundlePath?: string;
}

interface FilePart {
  readonly kind: 'file';
  readonly name: 'bundle';
  readonly filename: string;
  readonly contentType: string;
  readonly absolutePath: string;
  readonly bundlePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

type UploadPart = BytesPart | FilePart;

function configurationError(message: string): never {
  throw new DeploymentUploadError('HQ_UPLOAD_CONFIGURATION', message);
}

function endpointUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    configurationError('Deployment endpoint must be an absolute HTTPS URL.');
  }
  if (url.protocol !== 'https:') {
    configurationError('Deployment endpoint must use HTTPS.');
  }
  if (url.username || url.password) {
    configurationError('Deployment endpoint must not contain credentials.');
  }
  if (url.hash) configurationError('Deployment endpoint must not contain a URL fragment.');
  return url.toString();
}

function bearerToken(input: string): string {
  if (input.length < 1 || input.length > 4096 || input.trim() !== input
    || [...input].some(character => {
      const code = character.charCodeAt(0);
      return code < 0x21 || code > 0x7e;
    })) {
    configurationError('HYPEQUERY_API_TOKEN contains invalid characters or length.');
  }
  return input;
}

function timeout(input: number | undefined): number {
  const value = input ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 1 || value > 10 * 60_000) {
    configurationError('Deployment upload timeout must be between 1 and 600000 milliseconds.');
  }
  return value;
}

function partHeader(boundary: string, part: UploadPart): Uint8Array {
  const headers = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"`,
    `Content-Type: ${part.contentType}`,
    ...(part.bundlePath ? [`X-HypeQuery-Bundle-Path: ${part.bundlePath}`] : []),
    '',
    '',
  ].join('\r\n');
  return textEncoder.encode(headers);
}

function uploadParts(
  bundle: VerifiedDeploymentBundle,
  release: PreparedProtocolDeploymentReleaseEnvelope,
  manifest: PreparedProtocolDeploymentBundleManifest,
): readonly UploadPart[] {
  const root = bundle.directory;
  return Object.freeze([
    {
      kind: 'bytes',
      name: 'release',
      filename: 'release.json',
      contentType: 'application/json',
      bytes: release.bytes,
    },
    {
      kind: 'bytes',
      name: 'bundle',
      filename: DEPLOYMENT_BUNDLE_MANIFEST,
      contentType: 'application/json',
      bundlePath: DEPLOYMENT_BUNDLE_MANIFEST,
      bytes: textEncoder.encode(`${manifest.canonical}\n`),
    },
    {
      kind: 'file',
      name: 'bundle',
      filename: path.basename(manifest.manifest.deployment.path),
      contentType: 'application/json',
      absolutePath: path.join(root, ...manifest.manifest.deployment.path.split('/')),
      bundlePath: manifest.manifest.deployment.path,
      byteLength: manifest.manifest.deployment.byteLength,
      sha256: manifest.manifest.deployment.sha256,
    },
    ...manifest.manifest.artifacts.map(artifact => ({
      kind: 'file' as const,
      name: 'bundle' as const,
      filename: path.basename(artifact.path),
      contentType: 'application/octet-stream',
      absolutePath: path.join(root, ...artifact.path.split('/')),
      bundlePath: artifact.path,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
    })),
  ]);
}

async function* streamVerifiedFile(part: FilePart): AsyncGenerator<Uint8Array> {
  let handle;
  try {
    handle = await open(part.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const initial = await handle.stat();
    if (!initial.isFile() || initial.size !== part.byteLength) {
      throw new DeploymentUploadError(
        'HQ_UPLOAD_BUNDLE_CHANGED',
        `Bundle entry changed after verification: ${part.bundlePath}`,
      );
    }
    const digest = createHash('sha256');
    let bytesRead = 0;
    for await (const value of handle.createReadStream({ autoClose: false })) {
      const chunk = value as Uint8Array;
      bytesRead += chunk.byteLength;
      if (bytesRead > part.byteLength) {
        throw new DeploymentUploadError(
          'HQ_UPLOAD_BUNDLE_CHANGED',
          `Bundle entry changed after verification: ${part.bundlePath}`,
        );
      }
      digest.update(chunk);
      yield chunk;
    }
    if (bytesRead !== part.byteLength || digest.digest('hex') !== part.sha256) {
      throw new DeploymentUploadError(
        'HQ_UPLOAD_BUNDLE_CHANGED',
        `Bundle entry changed after verification: ${part.bundlePath}`,
      );
    }
  } catch (error) {
    if (error instanceof DeploymentUploadError) throw error;
    throw new DeploymentUploadError(
      'HQ_UPLOAD_BUNDLE_CHANGED',
      `Cannot safely read verified bundle entry ${part.bundlePath}: `
      + (error instanceof Error ? error.message : String(error)),
    );
  } finally {
    await handle?.close();
  }
}

function multipartLength(boundary: string, parts: readonly UploadPart[]): number {
  const separatorBytes = 2;
  const ending = textEncoder.encode(`--${boundary}--\r\n`).byteLength;
  return parts.reduce((total, part) => (
    total + partHeader(boundary, part).byteLength
    + (part.kind === 'bytes' ? part.bytes.byteLength : part.byteLength)
    + separatorBytes
  ), ending);
}

async function* multipartBody(
  boundary: string,
  parts: readonly UploadPart[],
): AsyncGenerator<Uint8Array> {
  const separator = textEncoder.encode('\r\n');
  for (const part of parts) {
    yield partHeader(boundary, part);
    if (part.kind === 'bytes') {
      yield part.bytes;
    } else {
      yield* streamVerifiedFile(part);
    }
    yield separator;
  }
  yield textEncoder.encode(`--${boundary}--\r\n`);
}

async function readBoundedResponse(response: DeploymentHttpResponse): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new DeploymentUploadError(
          'HQ_UPLOAD_INVALID_RESPONSE',
          'Deployment service response exceeds 65536 bytes.',
          response.status,
        );
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
    return textDecoder.decode(bytes);
  } catch {
    throw new DeploymentUploadError(
      'HQ_UPLOAD_INVALID_RESPONSE',
      'Deployment service response is not valid UTF-8.',
      response.status,
    );
  }
}

function exactRecord(value: unknown, fields: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return undefined;
  }
  return record;
}

function validateSubmissionResponse(
  input: unknown,
  bundleIdentity: string,
  releaseIdentity: string,
  status: number,
): DeploymentSubmissionResponse {
  const value = exactRecord(input, [
    'kind',
    'version',
    'status',
    'releaseIdentity',
    'bundleIdentity',
  ]);
  if (!value
    || value.kind !== 'hypequery-deployment-submission'
    || value.version !== 1
    || (value.status !== 'accepted' && value.status !== 'already-exists')
    || typeof value.releaseIdentity !== 'string'
    || typeof value.bundleIdentity !== 'string'
    || !SHA256_PATTERN.test(value.releaseIdentity)
    || !SHA256_PATTERN.test(value.bundleIdentity)
    || value.releaseIdentity !== releaseIdentity
    || value.bundleIdentity !== bundleIdentity) {
    throw new DeploymentUploadError(
      'HQ_UPLOAD_INVALID_RESPONSE',
      'Deployment service returned an invalid or mismatched submission response.',
      status,
    );
  }
  return Object.freeze({
    kind: value.kind,
    version: value.version,
    status: value.status,
    releaseIdentity: value.releaseIdentity,
    bundleIdentity: value.bundleIdentity,
  });
}

function rejectedMessage(response: DeploymentHttpResponse, body: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as unknown;
    const error = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).error
      : undefined;
    if (typeof error === 'object' && error !== null && !Array.isArray(error)) {
      const code = (error as Record<string, unknown>).code;
      const message = (error as Record<string, unknown>).message;
      if (typeof code === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(code)) detail += ` ${code}`;
      if (typeof message === 'string') {
        const safe = [...message].map(character => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
        }).join('').slice(0, 512).trim();
        if (safe) detail += `: ${safe}`;
      }
    }
  } catch {
    // Rejection bodies are optional; status remains authoritative.
  }
  return `Deployment service rejected the submission (${response.status} ${response.statusText})${detail}.`;
}

function nestedUploadError(input: unknown): DeploymentUploadError | undefined {
  let current = input;
  for (let depth = 0; depth < 4; depth += 1) {
    if (current instanceof DeploymentUploadError) return current;
    if (typeof current !== 'object' || current === null || !('cause' in current)) return undefined;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

const defaultFetch: DeploymentFetch = async (input, init) => (
  fetch(input, init as never) as Promise<DeploymentHttpResponse>
);

export function createHttpDeploymentUploadTransport(
  options: HttpDeploymentUploadTransportOptions,
): DeploymentUploadTransport {
  const endpoint = endpointUrl(options.endpoint);
  const token = bearerToken(options.token);
  const timeoutMs = timeout(options.timeoutMs);
  const fetchImplementation = options.fetch ?? defaultFetch;
  const transport: DeploymentUploadTransport = {
    async submit(
      bundle: VerifiedDeploymentBundle,
      release: PreparedProtocolDeploymentReleaseEnvelope,
    ) {
      const manifest = prepareProtocolDeploymentBundleManifest(bundle.manifest);
      const preparedRelease = prepareProtocolDeploymentReleaseEnvelope(release.release);
      if (manifest.identity !== bundle.identity
        || preparedRelease.identity !== release.identity
        || preparedRelease.release.bundleIdentity !== manifest.identity) {
        throw new DeploymentUploadError(
          'HQ_UPLOAD_IDENTITY_MISMATCH',
          'Release and bundle identities do not match their verified content.',
        );
      }
      const boundary = `hypequery-${randomUUID()}`;
      const parts = uploadParts(bundle, preparedRelease, manifest);
      let response: DeploymentHttpResponse;
      try {
        response = await fetchImplementation(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(multipartLength(boundary, parts)),
            'Idempotency-Key': preparedRelease.identity,
            'X-HypeQuery-Bundle-Identity': manifest.identity,
            'X-HypeQuery-Release-Identity': preparedRelease.identity,
          },
          body: multipartBody(boundary, parts),
          duplex: 'half',
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const uploadError = nestedUploadError(error);
        if (uploadError) throw uploadError;
        throw new DeploymentUploadError(
          'HQ_UPLOAD_NETWORK',
          `Deployment service request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      let body: string;
      try {
        body = await readBoundedResponse(response);
      } catch (error) {
        if (error instanceof DeploymentUploadError) throw error;
        throw new DeploymentUploadError(
          'HQ_UPLOAD_NETWORK',
          `Deployment service response failed: ${error instanceof Error ? error.message : String(error)}`,
          response.status,
        );
      }
      if (!response.ok) {
        throw new DeploymentUploadError(
          'HQ_UPLOAD_REJECTED',
          rejectedMessage(response, body),
          response.status,
        );
      }
      let input: unknown;
      try {
        input = JSON.parse(body);
      } catch {
        throw new DeploymentUploadError(
          'HQ_UPLOAD_INVALID_RESPONSE',
          'Deployment service returned invalid JSON.',
          response.status,
        );
      }
      return validateSubmissionResponse(
        input,
        manifest.identity,
        preparedRelease.identity,
        response.status,
      );
    },
  };
  return Object.freeze(transport);
}
