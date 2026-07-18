import { bundleError } from './errors.js';
import { resolveDeploymentBundleLimits } from './limits.js';
import type {
  ProtocolDeploymentBundleArtifact,
  ProtocolDeploymentBundleDeployment,
  ProtocolDeploymentBundleLimits,
  ProtocolDeploymentBundleManifest,
  ProtocolDeploymentBundleOptions,
} from './types.js';

type DataRecord = Record<string, unknown>;
const textEncoder = new TextEncoder();
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

function requireRecord(input: unknown, path: string): DataRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    bundleError('HQ_BUNDLE_TYPE', path);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    bundleError('HQ_BUNDLE_UNSAFE_OBJECT', path);
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    bundleError('HQ_BUNDLE_UNSAFE_OBJECT', path);
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      bundleError('HQ_BUNDLE_UNSAFE_OBJECT', path);
    }
  }
  return input as DataRecord;
}

function requireArray(input: unknown, path: string, maxItems: number): readonly unknown[] {
  if (!Array.isArray(input)) bundleError('HQ_BUNDLE_TYPE', path);
  if (Object.getPrototypeOf(input) !== Array.prototype
    || Object.getOwnPropertySymbols(input).length > 0) {
    bundleError('HQ_BUNDLE_UNSAFE_OBJECT', path);
  }
  if (input.length > maxItems) bundleError('HQ_BUNDLE_TOO_MANY_ITEMS', path);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      bundleError('HQ_BUNDLE_UNSAFE_OBJECT', `${path}[${index}]`);
    }
  }
  if (Object.keys(input).length !== input.length
    || Object.getOwnPropertyNames(input).length !== input.length + 1) {
    bundleError('HQ_BUNDLE_UNSAFE_OBJECT', path);
  }
  return input;
}

function exactFields(value: DataRecord, required: readonly string[], path: string): void {
  const allowed = new Set(required);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) bundleError('HQ_BUNDLE_UNKNOWN_FIELD', `${path}.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) bundleError('HQ_BUNDLE_TYPE', `${path}.${key}`);
  }
}

function freezeRecord(entries: Record<string, unknown>): DataRecord {
  return Object.freeze(Object.assign(Object.create(null), entries)) as DataRecord;
}

function digest(value: unknown, path: string): string {
  if (typeof value !== 'string') bundleError('HQ_BUNDLE_TYPE', path);
  if (!SHA256_PATTERN.test(value)) bundleError('HQ_BUNDLE_INVALID_VALUE', path);
  return value;
}

function byteLength(value: unknown, path: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    bundleError('HQ_BUNDLE_INVALID_VALUE', path);
  }
  if ((value as number) > maximum) bundleError('HQ_BUNDLE_TOO_LARGE', path);
  return value as number;
}

function relativePath(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== 'string') bundleError('HQ_BUNDLE_TYPE', path);
  if (value.length > maxBytes || textEncoder.encode(value).byteLength > maxBytes) {
    bundleError('HQ_BUNDLE_TOO_LARGE', path);
  }
  const segments = value.split('/');
  if (segments.some(segment => !PATH_SEGMENT_PATTERN.test(segment)
      || segment.endsWith('.')
      || WINDOWS_RESERVED_NAME.test(segment))) {
    bundleError('HQ_BUNDLE_INVALID_PATH', path);
  }
  return value;
}

function validateDeployment(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentBundleLimits>,
): ProtocolDeploymentBundleDeployment {
  const value = requireRecord(input, path);
  exactFields(value, ['path', 'identity', 'sha256', 'byteLength'], path);
  return freezeRecord({
    path: relativePath(value.path, `${path}.path`, limits.maxPathBytes),
    identity: digest(value.identity, `${path}.identity`),
    sha256: digest(value.sha256, `${path}.sha256`),
    byteLength: byteLength(value.byteLength, `${path}.byteLength`, limits.maxDeploymentBytes),
  }) as unknown as ProtocolDeploymentBundleDeployment;
}

function validateArtifact(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentBundleLimits>,
): ProtocolDeploymentBundleArtifact {
  const value = requireRecord(input, path);
  exactFields(value, ['runtime', 'path', 'sha256', 'byteLength'], path);
  if (value.runtime !== 'node' && value.runtime !== 'python') {
    if (typeof value.runtime !== 'string') bundleError('HQ_BUNDLE_TYPE', `${path}.runtime`);
    bundleError('HQ_BUNDLE_INVALID_VALUE', `${path}.runtime`);
  }
  return freezeRecord({
    runtime: value.runtime,
    path: relativePath(value.path, `${path}.path`, limits.maxPathBytes),
    sha256: digest(value.sha256, `${path}.sha256`),
    byteLength: byteLength(value.byteLength, `${path}.byteLength`, limits.maxArtifactBytes),
  }) as unknown as ProtocolDeploymentBundleArtifact;
}

export function validateProtocolDeploymentBundleManifest(
  input: unknown,
  options: ProtocolDeploymentBundleOptions = {},
): ProtocolDeploymentBundleManifest {
  const limits = resolveDeploymentBundleLimits(options);
  const value = requireRecord(input, '$');
  exactFields(value, ['kind', 'version', 'deployment', 'artifacts'], '$');
  if (value.kind !== 'hypequery-deployment-bundle') {
    if (typeof value.kind !== 'string') bundleError('HQ_BUNDLE_TYPE', '$.kind');
    bundleError('HQ_BUNDLE_INVALID_VALUE', '$.kind');
  }
  if (value.version !== 1) {
    if (typeof value.version !== 'number') bundleError('HQ_BUNDLE_TYPE', '$.version');
    bundleError('HQ_BUNDLE_INVALID_VERSION', '$.version');
  }

  const deployment = validateDeployment(value.deployment, '$.deployment', limits);
  const artifacts = Object.freeze(requireArray(value.artifacts, '$.artifacts', limits.maxArtifacts)
    .map((artifact, index) => validateArtifact(artifact, `$.artifacts[${index}]`, limits)));
  const paths = [deployment.path, ...artifacts.map(artifact => artifact.path)];
  if (new Set(paths).size !== paths.length
    || new Set(paths.map(bundlePath => bundlePath.toLowerCase())).size !== paths.length) {
    bundleError('HQ_BUNDLE_INVALID_REFERENCE', '$.artifacts');
  }
  if (new Set(artifacts.map(artifact => artifact.sha256)).size !== artifacts.length) {
    bundleError('HQ_BUNDLE_INVALID_REFERENCE', '$.artifacts');
  }
  const sortedPaths = artifacts.map(artifact => artifact.path).sort();
  if (artifacts.some((artifact, index) => artifact.path !== sortedPaths[index])) {
    bundleError('HQ_BUNDLE_INVALID_VALUE', '$.artifacts');
  }
  const totalBytes = deployment.byteLength
    + artifacts.reduce((total, artifact) => total + artifact.byteLength, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
    bundleError('HQ_BUNDLE_TOO_LARGE', '$');
  }

  return freezeRecord({
    kind: 'hypequery-deployment-bundle',
    version: 1,
    deployment,
    artifacts,
  }) as unknown as ProtocolDeploymentBundleManifest;
}
