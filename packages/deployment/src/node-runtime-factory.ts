import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { DeploymentRuntimeSnapshot } from './runtime-materialization.js';
import type {
  DeploymentRuntimeFactory,
  DeploymentRuntimeInstance,
  DeploymentRuntimeInstanceInvocation,
} from './runtime-supervisor.js';

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const MAX_STARTUP_TIMEOUT_MS = 5 * 60_000;

const WORKER_SOURCE = [
  "const { parentPort, workerData } = require('node:worker_threads');",
  "const { pathToFileURL } = require('node:url');",
  'const handlers = new Map();',
  'function errorValue(error) {',
  "  return { name: error instanceof Error ? error.name : 'Error',",
  "    message: error instanceof Error ? error.message : String(error) };",
  '}',
  'function resolveEntrypoint(module, entrypoint) {',
  '  let value = module;',
  "  for (const segment of entrypoint.split('.')) value = value?.[segment];",
  "  if (typeof value !== 'function') throw new Error(`Runtime entrypoint is unavailable: ${entrypoint}`);",
  '  return value;',
  '}',
  '(async () => {',
  '  for (const artifact of workerData.artifacts) {',
  '    const module = await import(pathToFileURL(artifact.path).href);',
  '    for (const entrypoint of artifact.entrypoints) {',
  '      handlers.set(entrypoint, resolveEntrypoint(module, entrypoint));',
  '    }',
  '  }',
  "  parentPort.postMessage({ kind: 'ready' });",
  "  parentPort.on('message', async message => {",
  "    if (message.kind === 'health') {",
  "      parentPort.postMessage({ kind: 'result', id: message.id, value: null });",
  '      return;',
  '    }',
  "    if (message.kind !== 'invoke') return;",
  '    try {',
  '      const handler = handlers.get(message.entrypoint);',
  "      if (!handler) throw new Error(`Runtime entrypoint is unavailable: ${message.entrypoint}`);",
  '      const value = await handler(message.argument);',
  "      parentPort.postMessage({ kind: 'result', id: message.id, value });",
  '    } catch (error) {',
  "      parentPort.postMessage({ kind: 'failure', id: message.id, error: errorValue(error) });",
  '    }',
  '  });',
  '})().catch(error => {',
  "  parentPort.postMessage({ kind: 'fatal', error: errorValue(error) });",
  '});',
].join('\n');

export type NodeDeploymentRuntimeErrorCode =
  | 'HQ_NODE_RUNTIME_CONFIGURATION'
  | 'HQ_NODE_RUNTIME_UNSUPPORTED_ARTIFACT'
  | 'HQ_NODE_RUNTIME_INVALID_ARTIFACT'
  | 'HQ_NODE_RUNTIME_START_FAILED'
  | 'HQ_NODE_RUNTIME_WORKER_EXITED'
  | 'HQ_NODE_RUNTIME_INVOCATION_FAILED'
  | 'HQ_NODE_RUNTIME_ABORTED'
  | 'HQ_NODE_RUNTIME_CLOSED';

export class NodeDeploymentRuntimeError extends Error {
  readonly code: NodeDeploymentRuntimeErrorCode;

  constructor(
    code: NodeDeploymentRuntimeErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'NodeDeploymentRuntimeError';
    this.code = code;
  }
}

export type NodeDeploymentRuntimeEnvironment = Readonly<Record<string, string>>;

export type NodeDeploymentRuntimeEnvironmentResolver = (
  snapshot: DeploymentRuntimeSnapshot,
  input: { readonly signal?: AbortSignal },
) => NodeDeploymentRuntimeEnvironment | Promise<NodeDeploymentRuntimeEnvironment>;

export interface NodeDeploymentRuntimeFactoryOptions {
  readonly temporaryDirectory?: string;
  /** Worker import deadline from 1 through 300,000 milliseconds. */
  readonly startupTimeoutMs?: number;
  /**
   * Resolve an explicit environment for one immutable runtime snapshot.
   * When configured, this replaces inherited process environment state for
   * the worker. Omit it to preserve Node's default environment inheritance.
   */
  readonly resolveEnvironment?: NodeDeploymentRuntimeEnvironmentResolver;
  readonly onCleanupError?: (error: unknown, directory: string) => void;
}

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly cleanup: () => void;
}

interface WorkerErrorValue {
  readonly name?: unknown;
  readonly message?: unknown;
}

interface WorkerResponse {
  readonly kind?: unknown;
  readonly id?: unknown;
  readonly value?: unknown;
  readonly error?: WorkerErrorValue;
}

function nodeRuntimeError(
  code: NodeDeploymentRuntimeErrorCode,
  message: string,
  cause?: unknown,
): NodeDeploymentRuntimeError {
  return new NodeDeploymentRuntimeError(code, message, { cause });
}

function startupTimeout(input: number | undefined): number {
  const value = input ?? DEFAULT_STARTUP_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_STARTUP_TIMEOUT_MS) {
    throw nodeRuntimeError(
      'HQ_NODE_RUNTIME_CONFIGURATION',
      `startupTimeoutMs must be between 1 and ${MAX_STARTUP_TIMEOUT_MS}.`,
    );
  }
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function invalidEnvironment(): NodeDeploymentRuntimeError {
  return nodeRuntimeError(
    'HQ_NODE_RUNTIME_START_FAILED',
    'The Node deployment runtime environment is invalid.',
  );
}

function validateEnvironment(input: unknown): Record<string, string> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalidEnvironment();
  }
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    throw invalidEnvironment();
  }
  const environment = Object.create(null) as Record<string, string>;
  for (const key of keys) {
    if (typeof key !== 'string' || key.length === 0 || key.includes('\0') || key.includes('=')) {
      throw invalidEnvironment();
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(input, key);
    } catch {
      throw invalidEnvironment();
    }
    if (!descriptor?.enumerable
      || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string'
      || descriptor.value.includes('\0')) {
      throw invalidEnvironment();
    }
    environment[key] = descriptor.value;
  }
  return environment;
}

async function resolveWorkerEnvironment(
  resolver: NodeDeploymentRuntimeEnvironmentResolver | undefined,
  snapshot: DeploymentRuntimeSnapshot,
  signal: AbortSignal | undefined,
): Promise<Record<string, string> | undefined> {
  if (!resolver) return undefined;
  if (signal?.aborted) {
    throw nodeRuntimeError(
      'HQ_NODE_RUNTIME_ABORTED',
      'Node runtime startup was aborted.',
      signal.reason,
    );
  }
  let resolved: unknown;
  try {
    resolved = await resolver(snapshot, { signal });
  } catch (error) {
    if (signal?.aborted) {
      throw nodeRuntimeError(
        'HQ_NODE_RUNTIME_ABORTED',
        'Node runtime startup was aborted.',
        signal.reason,
      );
    }
    throw nodeRuntimeError(
      'HQ_NODE_RUNTIME_START_FAILED',
      'The Node deployment runtime environment could not be resolved.',
      error,
    );
  }
  if (signal?.aborted) {
    throw nodeRuntimeError(
      'HQ_NODE_RUNTIME_ABORTED',
      'Node runtime startup was aborted.',
      signal.reason,
    );
  }
  return validateEnvironment(resolved);
}

async function ensureTemporaryDirectory(input: string | undefined): Promise<string> {
  const directory = path.resolve(input ?? tmpdir());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw nodeRuntimeError(
      'HQ_NODE_RUNTIME_CONFIGURATION',
      'The Node runtime temporary directory must be a regular directory.',
    );
  }
  return directory;
}

function remoteError(input: WorkerErrorValue | undefined): Error {
  const message = typeof input?.message === 'string'
    ? input.message.slice(0, 4096)
    : 'The runtime worker failed without an error message.';
  const error = new Error(message);
  if (typeof input?.name === 'string') error.name = input.name.slice(0, 128);
  return error;
}

function workerInstance(
  worker: Worker,
  directory: string,
  ready: Promise<void>,
): DeploymentRuntimeInstance & { readonly ready: Promise<void> } {
  const pending = new Map<number, PendingCall>();
  let sequence = 0;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let terminalError: NodeDeploymentRuntimeError | undefined;

  function failPending(error: unknown): void {
    for (const call of pending.values()) {
      call.cleanup();
      call.reject(error);
    }
    pending.clear();
  }

  worker.on('message', (message: WorkerResponse) => {
    if ((message.kind !== 'result' && message.kind !== 'failure')
      || !Number.isSafeInteger(message.id)) return;
    const call = pending.get(message.id as number);
    if (!call) return;
    pending.delete(message.id as number);
    call.cleanup();
    if (message.kind === 'result') call.resolve(message.value);
    else call.reject(nodeRuntimeError(
      'HQ_NODE_RUNTIME_INVOCATION_FAILED',
      'The Node deployment runtime invocation failed.',
      remoteError(message.error),
    ));
  });
  worker.on('error', error => {
    terminalError = nodeRuntimeError(
      'HQ_NODE_RUNTIME_WORKER_EXITED',
      'The Node deployment runtime worker failed.',
      error,
    );
    failPending(terminalError);
  });
  worker.on('exit', code => {
    if (!closed) {
      terminalError = nodeRuntimeError(
        'HQ_NODE_RUNTIME_WORKER_EXITED',
        `The Node deployment runtime worker exited unexpectedly with code ${code}.`,
      );
      failPending(terminalError);
    }
  });

  function call(
    kind: 'health' | 'invoke',
    payload: Readonly<Record<string, unknown>>,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    if (closed || terminalError) {
      return Promise.reject(terminalError ?? nodeRuntimeError(
        'HQ_NODE_RUNTIME_CLOSED',
        'The Node deployment runtime worker is closed.',
      ));
    }
    if (signal?.aborted) {
      return Promise.reject(nodeRuntimeError(
        'HQ_NODE_RUNTIME_ABORTED',
        'The Node deployment runtime invocation was aborted.',
        signal.reason,
      ));
    }
    const id = sequence;
    sequence += 1;
    return new Promise((resolve, reject) => {
      const observeAbort = kind === 'health';
      const abort = () => {
        pending.delete(id);
        reject(nodeRuntimeError(
          'HQ_NODE_RUNTIME_ABORTED',
          'The Node deployment runtime health check was aborted.',
          signal?.reason,
        ));
      };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      pending.set(id, { resolve, reject, cleanup });
      if (observeAbort) signal?.addEventListener('abort', abort, { once: true });
      try {
        worker.postMessage({ kind, id, ...payload });
      } catch (error) {
        pending.delete(id);
        cleanup();
        reject(nodeRuntimeError(
          'HQ_NODE_RUNTIME_INVOCATION_FAILED',
          'The Node deployment runtime invocation could not be sent.',
          error,
        ));
      }
    });
  }

  return {
    ready,
    async healthCheck({ signal }): Promise<void> {
      await call('health', {}, signal);
    },
    invoke(input: DeploymentRuntimeInstanceInvocation): Promise<unknown> {
      return call('invoke', {
        entrypoint: input.binding.entrypoint,
        argument: input.argument,
      }, input.signal);
    },
    async close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      const error = nodeRuntimeError(
        'HQ_NODE_RUNTIME_CLOSED',
        'The Node deployment runtime worker was closed.',
      );
      failPending(error);
      closePromise = (async () => {
        try {
          await worker.terminate();
        } finally {
          await rm(directory, { force: true, recursive: true });
        }
      })();
      return closePromise;
    },
  };
}

async function startWorker(
  snapshot: DeploymentRuntimeSnapshot,
  directory: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  resolveEnvironment: NodeDeploymentRuntimeEnvironmentResolver | undefined,
): Promise<DeploymentRuntimeInstance> {
  if (signal?.aborted) {
    throw nodeRuntimeError('HQ_NODE_RUNTIME_ABORTED', 'Node runtime startup was aborted.', signal.reason);
  }
  const artifacts: { readonly path: string; readonly entrypoints: readonly string[] }[] = [];
  for (const artifact of snapshot.artifacts) {
    if (artifact.runtime !== 'node') {
      throw nodeRuntimeError(
        'HQ_NODE_RUNTIME_UNSUPPORTED_ARTIFACT',
        `The Node runtime factory cannot load a ${artifact.runtime} artifact.`,
      );
    }
    const bytes = artifact.read();
    if (bytes.byteLength !== artifact.byteLength || sha256(bytes) !== artifact.artifactSha256) {
      throw nodeRuntimeError(
        'HQ_NODE_RUNTIME_INVALID_ARTIFACT',
        'Materialized Node runtime bytes do not match their identity.',
      );
    }
    const artifactPath = path.join(directory, `${artifact.artifactSha256}.mjs`);
    await writeFile(artifactPath, bytes, { flag: 'wx', mode: 0o600 });
    artifacts.push(Object.freeze({ path: artifactPath, entrypoints: artifact.entrypoints }));
  }
  if (artifacts.length === 0) {
    throw nodeRuntimeError(
      'HQ_NODE_RUNTIME_UNSUPPORTED_ARTIFACT',
      'The deployment snapshot contains no Node runtime artifacts.',
    );
  }

  const environment = await resolveWorkerEnvironment(resolveEnvironment, snapshot, signal);
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { artifacts },
    ...(environment === undefined ? {} : { env: environment }),
  });
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timer = setTimeout(() => {
    rejectReady(nodeRuntimeError(
      'HQ_NODE_RUNTIME_START_FAILED',
      'The Node deployment runtime did not start before its deadline.',
    ));
  }, timeoutMs);
  timer.unref();
  const abort = () => rejectReady(nodeRuntimeError(
    'HQ_NODE_RUNTIME_ABORTED',
    'Node runtime startup was aborted.',
    signal?.reason,
  ));
  signal?.addEventListener('abort', abort, { once: true });
  const startupMessage = (message: WorkerResponse) => {
    if (message.kind === 'ready') resolveReady();
    if (message.kind === 'fatal') rejectReady(nodeRuntimeError(
      'HQ_NODE_RUNTIME_START_FAILED',
      'The Node deployment runtime could not import its artifacts.',
      remoteError(message.error),
    ));
  };
  const startupError = (error: Error) => rejectReady(nodeRuntimeError(
    'HQ_NODE_RUNTIME_START_FAILED',
    'The Node deployment runtime worker failed during startup.',
    error,
  ));
  const startupExit = (code: number) => rejectReady(nodeRuntimeError(
    'HQ_NODE_RUNTIME_START_FAILED',
    `The Node deployment runtime worker exited during startup with code ${code}.`,
  ));
  worker.on('message', startupMessage);
  worker.once('error', startupError);
  worker.once('exit', startupExit);
  const instance = workerInstance(worker, directory, ready);
  try {
    await ready;
    return instance;
  } catch (error) {
    try {
      await instance.close();
    } catch {
      // Preserve the startup failure; cleanup can be retried by the factory.
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    worker.off('message', startupMessage);
    worker.off('error', startupError);
    worker.off('exit', startupExit);
  }
}

export function createNodeWorkerDeploymentRuntimeFactory(
  options: NodeDeploymentRuntimeFactoryOptions = {},
): DeploymentRuntimeFactory {
  const timeoutMs = startupTimeout(options.startupTimeoutMs);
  return Object.freeze({
    async start(
      snapshot: DeploymentRuntimeSnapshot,
      input: { readonly signal?: AbortSignal },
    ): Promise<DeploymentRuntimeInstance> {
      const root = await ensureTemporaryDirectory(options.temporaryDirectory);
      const directory = await mkdtemp(path.join(root, 'hypequery-node-runtime-'));
      try {
        await chmod(directory, 0o700);
        return await startWorker(
          snapshot,
          directory,
          timeoutMs,
          input.signal,
          options.resolveEnvironment,
        );
      } catch (error) {
        try {
          await rm(directory, { force: true, recursive: true });
        } catch (cleanupError) {
          options.onCleanupError?.(cleanupError, directory);
          // Preserve the error that prevented a runtime from starting.
        }
        throw error;
      }
    },
  });
}
