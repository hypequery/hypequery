import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  open,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  prepareProtocolDeploymentBundleManifest,
  prepareProtocolDeploymentReleaseEnvelope,
  type PreparedProtocolDeploymentBundleManifest,
  type PreparedProtocolDeploymentReleaseEnvelope,
  type ProtocolDeploymentBundleFile,
} from '@hypequery/protocol';
import {
  DEPLOYMENT_BUNDLE_MANIFEST,
  verifyDeploymentBundle,
} from './bundle.js';
import {
  badRequest,
  DeploymentIntakeError,
  tooLarge,
} from './errors.js';
import { resolveDeploymentIntakeLimits } from './limits.js';
import {
  BoundedMultipartReader,
  type MultipartPartHeaders,
} from './multipart.js';
import type {
  DeploymentIntake,
  DeploymentIntakeOptions,
  DeploymentIntakeRequest,
  DeploymentIntakeResponse,
  DeploymentSubmissionResponse,
} from './types.js';

const BOUNDARY_PATTERN = /^[A-Za-z0-9-]{1,70}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

function requestHeader(
  headers: Readonly<Record<string, string | undefined>>,
  expectedName: string,
): string | undefined {
  const matches = Object.entries(headers)
    .filter(([name, value]) => value !== undefined && name.toLowerCase() === expectedName)
    .map(([, value]) => value!);
  if (matches.length > 1) throw badRequest(`Duplicate ${expectedName} request header.`);
  return matches[0];
}

function requireIdentityHeader(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = requestHeader(headers, name);
  if (!value || !DIGEST_PATTERN.test(value)) {
    throw badRequest(`The ${name} request header is invalid.`);
  }
  return value;
}

function bearerToken(headers: Readonly<Record<string, string | undefined>>): string {
  const authorization = requestHeader(headers, 'authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (token.length < 1 || token.length > 4096 || token.trim() !== token
    || [...token].some(character => {
      const code = character.charCodeAt(0);
      return code < 0x21 || code > 0x7e;
    })) {
    throw new DeploymentIntakeError(
      'HQ_INTAKE_UNAUTHENTICATED',
      'A valid bearer credential is required.',
    );
  }
  return token;
}

function contentLength(
  headers: Readonly<Record<string, string | undefined>>,
  maximum: number,
): number {
  const input = requestHeader(headers, 'content-length');
  if (!input || !/^[1-9][0-9]*$/.test(input)) {
    throw badRequest('An exact Content-Length request header is required.');
  }
  const value = Number(input);
  if (!Number.isSafeInteger(value)) throw tooLarge('The deployment request is too large.');
  if (value > maximum) throw tooLarge('The deployment request exceeds its byte limit.');
  return value;
}

function multipartBoundary(headers: Readonly<Record<string, string | undefined>>): string {
  const contentType = requestHeader(headers, 'content-type');
  const match = contentType?.match(/^multipart\/form-data; boundary=([^; ]+)$/);
  if (!match || !BOUNDARY_PATTERN.test(match[1]!)) {
    throw badRequest('Content-Type must declare a valid multipart boundary.');
  }
  return match[1]!;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw badRequest('The deployment request was aborted.', signal.reason);
}

async function bufferedPart(
  reader: BoundedMultipartReader,
  maximum: number,
): Promise<{ readonly bytes: Buffer; readonly final: boolean }> {
  const chunks: Buffer[] = [];
  const result = await reader.readPartBody(maximum, chunk => {
    chunks.push(Buffer.from(chunk));
  });
  return Object.freeze({ bytes: Buffer.concat(chunks, result.byteLength), final: result.final });
}

function requirePart(
  headers: MultipartPartHeaders,
  expected: {
    readonly name: 'release' | 'bundle';
    readonly filename: string;
    readonly contentType: 'application/json' | 'application/octet-stream';
    readonly bundlePath?: string;
  },
): void {
  if (headers.name !== expected.name
    || headers.filename !== expected.filename
    || headers.contentType !== expected.contentType
    || headers.bundlePath !== expected.bundlePath) {
    throw badRequest('Multipart parts do not match the deployment submission contract.');
  }
}

function decodeJson(bytes: Uint8Array, description: string): unknown {
  try {
    return JSON.parse(textDecoder.decode(bytes));
  } catch (error) {
    throw badRequest(`${description} is not valid UTF-8 JSON.`, error);
  }
}

function requireReconstructablePaths(manifest: PreparedProtocolDeploymentBundleManifest): void {
  const files = [
    manifest.manifest.deployment.path,
    ...manifest.manifest.artifacts.map(artifact => artifact.path),
  ];
  const fileSet = new Set(files);
  if (fileSet.has(DEPLOYMENT_BUNDLE_MANIFEST)) {
    throw badRequest('The bundle manifest path is reserved.');
  }
  for (const file of files) {
    const segments = file.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      if (fileSet.has(segments.slice(0, index).join('/'))) {
        throw badRequest('A bundle file path cannot also be a parent directory.');
      }
    }
  }
}

async function readRelease(
  reader: BoundedMultipartReader,
  maximum: number,
): Promise<PreparedProtocolDeploymentReleaseEnvelope> {
  requirePart(await reader.readPartHeaders(), {
    name: 'release',
    filename: 'release.json',
    contentType: 'application/json',
  });
  const part = await bufferedPart(reader, maximum);
  if (part.final) throw badRequest('The deployment submission is missing its bundle.');
  let prepared: PreparedProtocolDeploymentReleaseEnvelope;
  try {
    prepared = prepareProtocolDeploymentReleaseEnvelope(
      decodeJson(part.bytes, 'The deployment release'),
    );
  } catch (error) {
    if (error instanceof DeploymentIntakeError) throw error;
    throw badRequest('The deployment release is invalid.', error);
  }
  if (!part.bytes.equals(Buffer.from(prepared.bytes))) {
    throw badRequest('The deployment release must use canonical JSON without trailing bytes.');
  }
  return prepared;
}

async function readManifest(
  reader: BoundedMultipartReader,
  maximum: number,
): Promise<{
  readonly prepared: PreparedProtocolDeploymentBundleManifest;
  readonly bytes: Buffer;
}> {
  requirePart(await reader.readPartHeaders(), {
    name: 'bundle',
    filename: DEPLOYMENT_BUNDLE_MANIFEST,
    contentType: 'application/json',
    bundlePath: DEPLOYMENT_BUNDLE_MANIFEST,
  });
  const part = await bufferedPart(reader, maximum);
  if (part.final) throw badRequest('The deployment submission is missing bundle files.');
  let prepared: PreparedProtocolDeploymentBundleManifest;
  try {
    prepared = prepareProtocolDeploymentBundleManifest(
      decodeJson(part.bytes, 'The deployment bundle manifest'),
    );
  } catch (error) {
    if (error instanceof DeploymentIntakeError) throw error;
    throw badRequest('The deployment bundle manifest is invalid.', error);
  }
  const canonical = Buffer.from(`${prepared.canonical}\n`);
  if (!part.bytes.equals(canonical)) {
    throw badRequest(
      'The deployment bundle manifest must use canonical JSON followed by one newline.',
    );
  }
  requireReconstructablePaths(prepared);
  return Object.freeze({ prepared, bytes: canonical });
}

async function writeChunk(handle: Awaited<ReturnType<typeof open>>, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (result.bytesWritten < 1) throw new Error('Could not write deployment bundle bytes.');
    offset += result.bytesWritten;
  }
}

async function receiveBundleFile(
  reader: BoundedMultipartReader,
  root: string,
  file: ProtocolDeploymentBundleFile,
  contentType: 'application/json' | 'application/octet-stream',
  expectFinal: boolean,
): Promise<void> {
  requirePart(await reader.readPartHeaders(), {
    name: 'bundle',
    filename: path.basename(file.path),
    contentType,
    bundlePath: file.path,
  });
  const absolutePath = path.join(root, ...file.path.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const handle = await open(absolutePath, 'wx');
  const digest = createHash('sha256');
  let result: { readonly final: boolean; readonly byteLength: number };
  try {
    result = await reader.readPartBody(file.byteLength, async chunk => {
      digest.update(chunk);
      await writeChunk(handle, chunk);
    });
  } finally {
    await handle.close();
  }
  if (result.byteLength !== file.byteLength || digest.digest('hex') !== file.sha256) {
    throw badRequest(`Uploaded bundle bytes do not match the manifest: ${file.path}`);
  }
  if (result.final !== expectFinal) {
    throw badRequest(expectFinal
      ? 'The deployment submission contains undeclared bundle parts.'
      : 'The deployment submission is missing declared bundle parts.');
  }
}

function jsonResponse(
  status: number,
  body: unknown,
  additionalHeaders: Readonly<Record<string, string>> = {},
): DeploymentIntakeResponse {
  const encoded = `${JSON.stringify(body)}\n`;
  return Object.freeze({
    status,
    headers: Object.freeze({
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(encoded)),
      'cache-control': 'no-store',
      ...additionalHeaders,
    }),
    body: encoded,
  });
}

function errorResponse(error: unknown): DeploymentIntakeResponse {
  const intakeError = error instanceof DeploymentIntakeError
    ? error
    : new DeploymentIntakeError(
      'HQ_INTAKE_INTERNAL',
      'The deployment submission could not be processed.',
      { expose: false, cause: error },
    );
  const unsafeMessage = intakeError.expose
    ? intakeError.message
    : 'The deployment submission could not be processed.';
  const message = [...unsafeMessage].map(character => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f ? ' ' : character;
  }).join('').slice(0, 1024).trim() || 'The deployment submission was rejected.';
  return jsonResponse(intakeError.status, {
    error: { code: intakeError.code, message },
  }, intakeError.status === 401 ? { 'www-authenticate': 'Bearer' } : {});
}

async function removeTemporaryDirectory(directory: string, suppressError = false): Promise<void> {
  try {
    await rm(directory, { force: true, recursive: true });
  } catch (cleanupError) {
    if (!suppressError) {
      throw new DeploymentIntakeError(
        'HQ_INTAKE_INTERNAL',
        'The deployment submission could not be cleaned up.',
        { expose: false, cause: cleanupError },
      );
    }
  }
}

export function createDeploymentIntake<Principal>(
  options: DeploymentIntakeOptions<Principal>,
): DeploymentIntake {
  const limits = resolveDeploymentIntakeLimits(options.limits);

  async function process(request: DeploymentIntakeRequest): Promise<DeploymentIntakeResponse> {
    throwIfAborted(request.signal);
    const token = bearerToken(request.headers);
    const principal = await options.authenticator.authenticate({ token, signal: request.signal });
    if (principal === null) {
      throw new DeploymentIntakeError(
        'HQ_INTAKE_UNAUTHENTICATED',
        'The bearer credential was not accepted.',
      );
    }
    throwIfAborted(request.signal);

    const releaseHeader = requireIdentityHeader(request.headers, 'x-hypequery-release-identity');
    const bundleHeader = requireIdentityHeader(request.headers, 'x-hypequery-bundle-identity');
    const idempotencyKey = requireIdentityHeader(request.headers, 'idempotency-key');
    const declaredLength = contentLength(request.headers, limits.maxRequestBytes);
    const boundary = multipartBoundary(request.headers);
    const reader = new BoundedMultipartReader(
      request.body,
      boundary,
      declaredLength,
      limits.maxRequestBytes,
      limits.maxPartHeaderBytes,
      request.signal,
    );
    await reader.start();
    const release = await readRelease(reader, limits.maxReleaseBytes);
    if (release.identity !== releaseHeader || release.identity !== idempotencyKey
      || release.release.bundleIdentity !== bundleHeader) {
      throw badRequest('Deployment release identities do not match the uploaded release.');
    }
    const authorized = await options.authorizer.authorize({
      principal,
      target: release.release.target,
      releaseIdentity: release.identity,
      bundleIdentity: release.release.bundleIdentity,
      signal: request.signal,
    });
    if (!authorized) {
      throw new DeploymentIntakeError(
        'HQ_INTAKE_FORBIDDEN',
        'The caller is not authorized for the deployment target.',
      );
    }
    throwIfAborted(request.signal);

    const manifest = await readManifest(reader, limits.maxManifestBytes);
    if (manifest.prepared.identity !== bundleHeader
      || manifest.prepared.identity !== release.release.bundleIdentity) {
      throw badRequest('Deployment bundle identities do not match the uploaded manifest.');
    }

    const temporaryRoot = await mkdtemp(path.join(options.temporaryDirectory ?? tmpdir(), 'hypequery-intake-'));
    let cleaned = false;
    try {
      const bundleRoot = path.join(temporaryRoot, 'bundle');
      await mkdir(bundleRoot);
      await writeFile(path.join(bundleRoot, DEPLOYMENT_BUNDLE_MANIFEST), manifest.bytes, { flag: 'wx' });
      const files = [
        manifest.prepared.manifest.deployment,
        ...manifest.prepared.manifest.artifacts,
      ];
      for (let index = 0; index < files.length; index += 1) {
        await receiveBundleFile(
          reader,
          bundleRoot,
          files[index]!,
          index === 0 ? 'application/json' : 'application/octet-stream',
          index === files.length - 1,
        );
      }
      await reader.finish();
      throwIfAborted(request.signal);

      let bundle;
      try {
        bundle = await verifyDeploymentBundle(bundleRoot);
      } catch (error) {
        throw badRequest('The reconstructed deployment bundle is invalid.', error);
      }
      if (bundle.identity !== manifest.prepared.identity
        || bundle.identity !== release.release.bundleIdentity) {
        throw badRequest('The reconstructed deployment bundle identity is inconsistent.');
      }
      const status = await options.store.accept(Object.freeze({
        principal,
        release: release.release,
        releaseCanonical: release.canonical,
        releaseIdentity: release.identity,
        bundle,
      }));
      if (status !== 'accepted' && status !== 'already-exists') {
        throw new DeploymentIntakeError(
          'HQ_INTAKE_INTERNAL',
          'The deployment store returned an invalid status.',
          { expose: false },
        );
      }
      const response: DeploymentSubmissionResponse = Object.freeze({
        kind: 'hypequery-deployment-submission',
        version: 1,
        status,
        releaseIdentity: release.identity,
        bundleIdentity: bundle.identity,
      });
      await removeTemporaryDirectory(temporaryRoot);
      cleaned = true;
      return jsonResponse(status === 'accepted' ? 202 : 200, response);
    } finally {
      if (!cleaned) await removeTemporaryDirectory(temporaryRoot, true);
    }
  }

  return Object.freeze({
    async handle(request: DeploymentIntakeRequest): Promise<DeploymentIntakeResponse> {
      try {
        return await process(request);
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
}
