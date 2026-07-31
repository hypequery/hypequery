import { bundleError } from './errors.js';
import { resolveDeploymentBundleLimits } from './limits.js';
import type {
  ProtocolDeploymentBundleArtifact,
  ProtocolDeploymentBundleDeployment,
  ProtocolDeploymentBundleLimits,
  ProtocolDeploymentBundleManifest,
  ProtocolDeploymentBundleOptions,
  ProtocolDeploymentBundleSource,
  ProtocolDeploymentBundleSourceRevision,
} from './types.js';

type DataRecord = Record<string, unknown>;
const textEncoder = new TextEncoder();
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
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

function exactFields(
  value: DataRecord,
  required: readonly string[],
  path: string,
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
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

function byteLength(
  value: unknown,
  path: string,
  maximum: number,
  allowEmpty = false,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < (allowEmpty ? 0 : 1)) {
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

function validateSourceRevision(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentBundleLimits>,
): ProtocolDeploymentBundleSourceRevision {
  const value = requireRecord(input, path);
  exactFields(value, ['kind', 'commit', 'dirty'], path, ['branch']);
  if (value.kind !== 'git') {
    if (typeof value.kind !== 'string') bundleError('HQ_BUNDLE_TYPE', `${path}.kind`);
    bundleError('HQ_BUNDLE_INVALID_VALUE', `${path}.kind`);
  }
  if (typeof value.commit !== 'string') bundleError('HQ_BUNDLE_TYPE', `${path}.commit`);
  if (!GIT_COMMIT_PATTERN.test(value.commit)) {
    bundleError('HQ_BUNDLE_INVALID_VALUE', `${path}.commit`);
  }
  if (typeof value.dirty !== 'boolean') bundleError('HQ_BUNDLE_TYPE', `${path}.dirty`);
  let branch: string | undefined;
  if (value.branch !== undefined) {
    if (typeof value.branch !== 'string') bundleError('HQ_BUNDLE_TYPE', `${path}.branch`);
    if (textEncoder.encode(value.branch).byteLength > limits.maxPathBytes) {
      bundleError('HQ_BUNDLE_TOO_LARGE', `${path}.branch`);
    }
    const invalidCharacter = [...value.branch].some(character => {
      const code = character.charCodeAt(0);
      return code <= 0x20 || code === 0x7f || '~^:?*[\\'.includes(character);
    });
    const segments = value.branch.split('/');
    if (!value.branch || value.branch === '@' || value.branch.startsWith('-')
      || value.branch.startsWith('/') || value.branch.endsWith('/')
      || value.branch.endsWith('.') || value.branch.includes('//')
      || value.branch.includes('..') || value.branch.includes('@{')
      || invalidCharacter
      || segments.some(segment => segment.startsWith('.') || segment.endsWith('.lock'))) {
      bundleError('HQ_BUNDLE_INVALID_VALUE', `${path}.branch`);
    }
    branch = value.branch;
  }
  return freezeRecord({
    kind: 'git',
    commit: value.commit,
    dirty: value.dirty,
    ...(branch ? { branch } : {}),
  }) as unknown as ProtocolDeploymentBundleSourceRevision;
}

function validateSource(
  input: unknown,
  path: string,
  limits: Readonly<ProtocolDeploymentBundleLimits>,
): ProtocolDeploymentBundleSource {
  const value = requireRecord(input, path);
  exactFields(value, ['root', 'entrypoint', 'files'], path, ['revision']);
  const root = relativePath(value.root, `${path}.root`, limits.maxPathBytes);
  const entrypoint = relativePath(value.entrypoint, `${path}.entrypoint`, limits.maxPathBytes);
  const files = Object.freeze(
    requireArray(value.files, `${path}.files`, limits.maxSourceFiles)
      .map((inputFile, index) => {
        const filePath = `${path}.files[${index}]`;
        const file = requireRecord(inputFile, filePath);
        exactFields(file, ['path', 'sha256', 'byteLength'], filePath);
        return freezeRecord({
          path: relativePath(file.path, `${filePath}.path`, limits.maxPathBytes),
          sha256: digest(file.sha256, `${filePath}.sha256`),
          byteLength: byteLength(
            file.byteLength,
            `${filePath}.byteLength`,
            limits.maxSourceFileBytes,
            true,
          ),
        });
      }),
  ) as unknown as ProtocolDeploymentBundleSource['files'];
  if (files.length < 1 || !files.some(file => file.path === entrypoint)) {
    bundleError('HQ_BUNDLE_INVALID_REFERENCE', `${path}.entrypoint`);
  }
  const paths = files.map(file => file.path);
  if (new Set(paths).size !== paths.length
    || new Set(paths.map(filePath => filePath.toLowerCase())).size !== paths.length) {
    bundleError('HQ_BUNDLE_INVALID_REFERENCE', `${path}.files`);
  }
  const sortedPaths = [...paths].sort();
  if (paths.some((filePath, index) => filePath !== sortedPaths[index])) {
    bundleError('HQ_BUNDLE_INVALID_VALUE', `${path}.files`);
  }
  const sourceBytes = files.reduce((total, file) => total + file.byteLength, 0);
  if (!Number.isSafeInteger(sourceBytes) || sourceBytes > limits.maxSourceBytes) {
    bundleError('HQ_BUNDLE_TOO_LARGE', path);
  }
  return freezeRecord({
    root,
    entrypoint,
    files,
    ...(value.revision === undefined
      ? {}
      : { revision: validateSourceRevision(value.revision, `${path}.revision`, limits) }),
  }) as unknown as ProtocolDeploymentBundleSource;
}

function hasTreeCollision(paths: readonly string[]): boolean {
  const normalized = new Set(paths.map(bundlePath => bundlePath.toLowerCase()));
  return [...normalized].some((bundlePath) => {
    const segments = bundlePath.split('/');
    return segments.some(
      (_, index) => index > 0 && normalized.has(segments.slice(0, index).join('/')),
    );
  });
}

export function validateProtocolDeploymentBundleManifest(
  input: unknown,
  options: ProtocolDeploymentBundleOptions = {},
): ProtocolDeploymentBundleManifest {
  const limits = resolveDeploymentBundleLimits(options);
  const value = requireRecord(input, '$');
  exactFields(value, ['kind', 'version', 'deployment', 'artifacts'], '$', ['source']);
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
  const source = value.source === undefined
    ? undefined
    : validateSource(value.source, '$.source', limits);
  const sourcePaths = source?.files.map(file => `${source.root}/${file.path}`) ?? [];
  const paths = [deployment.path, ...artifacts.map(artifact => artifact.path), ...sourcePaths];
  if (new Set(paths).size !== paths.length
    || new Set(paths.map(bundlePath => bundlePath.toLowerCase())).size !== paths.length
    || hasTreeCollision(paths)) {
    bundleError('HQ_BUNDLE_INVALID_REFERENCE', '$');
  }
  if (new Set(artifacts.map(artifact => artifact.sha256)).size !== artifacts.length) {
    bundleError('HQ_BUNDLE_INVALID_REFERENCE', '$.artifacts');
  }
  const sortedPaths = artifacts.map(artifact => artifact.path).sort();
  if (artifacts.some((artifact, index) => artifact.path !== sortedPaths[index])) {
    bundleError('HQ_BUNDLE_INVALID_VALUE', '$.artifacts');
  }
  const totalBytes = deployment.byteLength
    + artifacts.reduce((total, artifact) => total + artifact.byteLength, 0)
    + (source?.files.reduce((total, file) => total + file.byteLength, 0) ?? 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
    bundleError('HQ_BUNDLE_TOO_LARGE', '$');
  }

  return freezeRecord({
    kind: 'hypequery-deployment-bundle',
    version: 1,
    deployment,
    artifacts,
    ...(source ? { source } : {}),
  }) as unknown as ProtocolDeploymentBundleManifest;
}
