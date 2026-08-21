// Drives an adapter over NDJSON: handshake, then one case at a time with a
// per-case timeout. On a premature adapter exit the runner respawns once and
// continues; a second premature exit fails the run.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { compareCase } from './compare.js';
import { createJsonLoader, loadManifest, resolveFixturesDir } from './fs.js';
import { enumerateAllCases } from './manifest.js';
import {
  CONFORMANCE_MANIFEST_VERSION,
  CONFORMANCE_PROTOCOL_VERSION,
  type AdapterHello,
  type CaseOutcome,
  type EnumeratedCase,
  type HostileObjectSuiteDeclaration,
  type RunSummary,
} from './types.js';

export interface RunConformanceOptions {
  readonly adapterCommand: readonly string[];
  readonly fixturesDir?: string;
  /** Restrict to these families (intersected with what the adapter announces). */
  readonly families?: readonly string[];
  readonly timeoutMs?: number;
  readonly skipFuzz?: boolean;
  readonly onlyFuzz?: boolean;
}

const DEFAULT_TIMEOUT_MS = 5_000;

class AdapterExitError extends Error {}
class AdapterTimeoutError extends Error {}

function parseHostileObjectSuite(
  value: unknown,
): HostileObjectSuiteDeclaration | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('adapter hostileObjectSuite must be an object');
  }
  const suite = value as Record<string, unknown>;
  if (!Number.isSafeInteger(suite.count) || (suite.count as number) < 1) {
    throw new Error('adapter hostileObjectSuite count must be a positive safe integer');
  }
  if (
    !Array.isArray(suite.mechanisms)
    || suite.mechanisms.length === 0
    || !suite.mechanisms.every((mechanism) => typeof mechanism === 'string' && mechanism.length > 0)
    || new Set(suite.mechanisms).size !== suite.mechanisms.length
  ) {
    throw new Error('adapter hostileObjectSuite mechanisms must be unique non-empty strings');
  }
  return {
    count: suite.count as number,
    mechanisms: [...suite.mechanisms] as string[],
  };
}

function parseAdapterHello(
  message: Record<string, unknown>,
  hostModelFamilies: ReadonlySet<string>,
): AdapterHello {
  if (
    message.type !== 'hello'
    || message.protocol !== CONFORMANCE_PROTOCOL_VERSION
    || !Array.isArray(message.families)
    || !message.families.every((family) => typeof family === 'string' && family.length > 0)
  ) {
    throw new Error('adapter did not answer the handshake');
  }
  const families = message.families as string[];
  const hostileObjectSuite = parseHostileObjectSuite(message.hostileObjectSuite);
  if (families.some((family) => hostModelFamilies.has(family)) && !hostileObjectSuite) {
    throw new Error('adapter must declare hostileObjectSuite for host-model families');
  }
  for (const field of ['implementation', 'version', 'language'] as const) {
    if (message[field] !== undefined && typeof message[field] !== 'string') {
      throw new Error(`adapter hello ${field} must be a string`);
    }
  }
  return {
    type: 'hello',
    protocol: CONFORMANCE_PROTOCOL_VERSION,
    families: [...families],
    ...(typeof message.implementation === 'string'
      ? { implementation: message.implementation }
      : {}),
    ...(typeof message.version === 'string' ? { version: message.version } : {}),
    ...(typeof message.language === 'string' ? { language: message.language } : {}),
    ...(hostileObjectSuite ? { hostileObjectSuite } : {}),
  };
}

/** A single adapter child process with a line-oriented message queue. */
class AdapterConnection {
  private child: ChildProcessWithoutNullStreams;
  private rl: Interface;
  private readonly queue: Record<string, unknown>[] = [];
  private waiter: ((message: Record<string, unknown>) => void) | undefined;
  private exited = false;

  constructor(command: readonly string[]) {
    this.child = spawn(command[0], command.slice(1), { shell: false });
    this.child.stderr.pipe(process.stderr);
    this.rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed === '') return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }
      if (this.waiter) {
        const resolve = this.waiter;
        this.waiter = undefined;
        resolve(message);
      } else {
        this.queue.push(message);
      }
    });
    this.child.on('exit', () => {
      this.exited = true;
    });
  }

  write(message: unknown): void {
    if (!this.exited) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  nextMessage(timeoutMs: number): Promise<Record<string, unknown>> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.exited) return Promise.reject(new AdapterExitError('adapter exited'));

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      // A single settle path clears the timer, the exit listener, and the
      // waiter so no timer can reject a promise that already resolved.
      const settle = (fn: () => void): void => {
        clearTimeout(timer);
        this.child.removeListener('exit', onExit);
        this.waiter = undefined;
        fn();
      };
      const onExit = (): void => settle(() => reject(new AdapterExitError('adapter exited')));
      const timer = setTimeout(
        () => settle(() => reject(new AdapterTimeoutError('timed out waiting for result'))),
        timeoutMs,
      );

      this.child.once('exit', onExit);
      this.waiter = (message) => settle(() => resolve(message));
    });
  }

  async handshake(
    timeoutMs: number,
    hostModelFamilies: ReadonlySet<string>,
  ): Promise<AdapterHello> {
    this.write({
      type: 'hello',
      protocol: CONFORMANCE_PROTOCOL_VERSION,
      manifestVersion: CONFORMANCE_MANIFEST_VERSION,
    });
    const message = await this.nextMessage(timeoutMs);
    return parseAdapterHello(message, hostModelFamilies);
  }

  end(): void {
    this.write({ type: 'end' });
    this.child.stdin.end();
  }

  kill(): void {
    if (!this.exited) this.child.kill('SIGKILL');
  }
}

export async function runConformance(options: RunConformanceOptions): Promise<RunSummary> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fixturesDir = resolveFixturesDir(options.fixturesDir);
  const manifest = loadManifest(fixturesDir);
  const loadJson = createJsonLoader(fixturesDir);

  const allCases = enumerateAllCases(manifest, loadJson);
  const hostModelFamilies = new Set(
    allCases
      .filter((c) => {
        const generator = c.case.generator;
        return typeof generator === 'object'
          && generator !== null
          && (generator as Record<string, unknown>).type === 'unsafe-accessor';
      })
      .map((c) => c.family),
  );
  let cases = allCases;
  if (options.onlyFuzz) cases = cases.filter((c) => c.role === 'fuzz');
  if (options.skipFuzz) cases = cases.filter((c) => c.role !== 'fuzz');
  if (options.families && options.families.length > 0) {
    const requested = new Set(options.families);
    cases = cases.filter((c) => requested.has(c.family));
  }

  // The handshake covers process spawn plus the adapter's first write, which
  // can be slow under load; it gets a generous timeout independent of the
  // per-case timeout so a busy machine never mistakes startup for a hang.
  const handshakeTimeoutMs = Math.max(timeoutMs, DEFAULT_TIMEOUT_MS);

  let connection = new AdapterConnection(options.adapterCommand);
  let hello: AdapterHello;
  try {
    hello = await connection.handshake(handshakeTimeoutMs, hostModelFamilies);
  } catch (error) {
    connection.kill();
    throw error;
  }
  let announced = new Set(hello.families);
  let respawnBudget = 1;

  const outcomes: CaseOutcome[] = [];
  let seq = 0;
  let notRun = 0;

  for (const ec of cases) {
    if (!announced.has(ec.family)) {
      notRun += 1;
      continue;
    }

    seq += 1;
    connection.write({
      type: 'case',
      seq,
      family: ec.family,
      role: ec.role,
      id: ec.id,
      ...(ec.section ? { section: ec.section } : {}),
      case: ec.case,
    });

    try {
      const message = await connection.nextMessage(timeoutMs);
      if (message.type !== 'result' || message.seq !== seq) {
        outcomes.push(failure(ec, 'protocol error', 'out-of-order result'));
        continue;
      }
      outcomes.push(compareCase(ec, message as never));
    } catch (error) {
      outcomes.push(
        failure(
          ec,
          'a result',
          error instanceof AdapterTimeoutError ? 'timeout' : 'adapter exited',
        ),
      );
      // Both failures leave the connection unusable: a crashed child is gone,
      // and a timed-out child may still deliver a late reply that would be
      // consumed as the next case's result — or block every later case and
      // outlive the run. Kill it and start fresh before continuing. Crashes are
      // rate-limited because they can recur instantly; timeouts are naturally
      // bounded by the per-case timeout, so they always refresh.
      if (error instanceof AdapterExitError) {
        if (respawnBudget <= 0) break;
        respawnBudget -= 1;
      }
      if (!(await refreshConnection())) break;
    }
  }

  connection.end();

  return summarize(outcomes, notRun, hello);

  async function refreshConnection(): Promise<boolean> {
    connection.kill();
    connection = new AdapterConnection(options.adapterCommand);
    try {
      hello = await connection.handshake(handshakeTimeoutMs, hostModelFamilies);
    } catch {
      // A replacement that cannot even complete a handshake ends the run
      // cleanly rather than throwing out of the loop.
      return false;
    }
    announced = new Set(hello.families);
    seq = 0;
    return true;
  }
}

function failure(ec: EnumeratedCase, expected: string, actual: string): CaseOutcome {
  return { family: ec.family, role: ec.role, id: ec.id, status: 'fail', expected, actual };
}

function summarize(
  outcomes: readonly CaseOutcome[],
  notRun: number,
  hello: AdapterHello,
): RunSummary {
  return {
    total: outcomes.length,
    passed: outcomes.filter((o) => o.status === 'pass').length,
    failed: outcomes.filter((o) => o.status === 'fail').length,
    skipped: outcomes.filter((o) => o.status === 'skip').length,
    notRun,
    adapter: {
      implementation: hello.implementation,
      version: hello.version,
      language: hello.language,
      families: hello.families,
      ...(hello.hostileObjectSuite
        ? { hostileObjectSuite: hello.hostileObjectSuite }
        : {}),
    },
    outcomes,
  };
}
