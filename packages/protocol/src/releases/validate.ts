import { releaseError } from './errors.js';
import { resolveDeploymentReleaseLimits } from './limits.js';
import type {
  ProtocolDeploymentReleaseEnvelope,
  ProtocolDeploymentReleaseOptions,
  ProtocolDeploymentReleaseTarget,
} from './types.js';

type DataRecord = Record<string, unknown>;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const textEncoder = new TextEncoder();

function requireRecord(input: unknown, path: string): DataRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    releaseError('HQ_RELEASE_TYPE', path);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    releaseError('HQ_RELEASE_UNSAFE_OBJECT', path);
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    releaseError('HQ_RELEASE_UNSAFE_OBJECT', path);
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      releaseError('HQ_RELEASE_UNSAFE_OBJECT', path);
    }
  }
  return input as DataRecord;
}

function exactFields(value: DataRecord, required: readonly string[], path: string): void {
  const allowed = new Set(required);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) releaseError('HQ_RELEASE_UNKNOWN_FIELD', `${path}.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) releaseError('HQ_RELEASE_TYPE', `${path}.${key}`);
  }
}

function freezeRecord(entries: Record<string, unknown>): DataRecord {
  return Object.freeze(Object.assign(Object.create(null), entries)) as DataRecord;
}

function targetToken(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string') releaseError('HQ_RELEASE_TYPE', path);
  if (value.length > maximum || textEncoder.encode(value).byteLength > maximum) {
    releaseError('HQ_RELEASE_TOO_LARGE', path);
  }
  if (!TARGET_PATTERN.test(value)) releaseError('HQ_RELEASE_INVALID_VALUE', path);
  return value;
}

function validateTargetWithMaximum(
  input: unknown,
  maximum: number,
): ProtocolDeploymentReleaseTarget {
  const value = requireRecord(input, '$.target');
  exactFields(value, ['project', 'environment'], '$.target');
  return freezeRecord({
    project: targetToken(value.project, '$.target.project', maximum),
    environment: targetToken(value.environment, '$.target.environment', maximum),
  }) as unknown as ProtocolDeploymentReleaseTarget;
}

export function validateProtocolDeploymentReleaseTarget(
  input: unknown,
  options: ProtocolDeploymentReleaseOptions = {},
): ProtocolDeploymentReleaseTarget {
  return validateTargetWithMaximum(
    input,
    resolveDeploymentReleaseLimits(options).maxTargetBytes,
  );
}

export function validateProtocolDeploymentReleaseEnvelope(
  input: unknown,
  options: ProtocolDeploymentReleaseOptions = {},
): ProtocolDeploymentReleaseEnvelope {
  const limits = resolveDeploymentReleaseLimits(options);
  const value = requireRecord(input, '$');
  exactFields(value, ['kind', 'version', 'bundleIdentity', 'target'], '$');
  if (value.kind !== 'hypequery-deployment-release') {
    if (typeof value.kind !== 'string') releaseError('HQ_RELEASE_TYPE', '$.kind');
    releaseError('HQ_RELEASE_INVALID_VALUE', '$.kind');
  }
  if (value.version !== 1) {
    if (typeof value.version !== 'number') releaseError('HQ_RELEASE_TYPE', '$.version');
    releaseError('HQ_RELEASE_INVALID_VERSION', '$.version');
  }
  if (typeof value.bundleIdentity !== 'string') {
    releaseError('HQ_RELEASE_TYPE', '$.bundleIdentity');
  }
  if (!SHA256_PATTERN.test(value.bundleIdentity)) {
    releaseError('HQ_RELEASE_INVALID_VALUE', '$.bundleIdentity');
  }
  return freezeRecord({
    kind: 'hypequery-deployment-release',
    version: 1,
    bundleIdentity: value.bundleIdentity,
    target: validateTargetWithMaximum(value.target, limits.maxTargetBytes),
  }) as unknown as ProtocolDeploymentReleaseEnvelope;
}
