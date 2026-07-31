// Reusable NDJSON adapter loop. An adapter wraps an implementation under test:
// it announces the families it supports, then answers one result line per case
// the runner sends. Used by the reference adapter and the datasets adapter.
import { createInterface } from 'node:readline';
import { CONFORMANCE_PROTOCOL_VERSION } from '../types.js';
import type { FixtureRole, HandlerResult, HostileObjectSuiteDeclaration } from '../types.js';

export interface StdioAdapterOptions {
  readonly implementation?: string;
  readonly version?: string;
  readonly language?: string;
  readonly families: readonly string[];
  /** RFC 0012 language-specific hostile-object suite declaration. */
  readonly hostileObjectSuite?: HostileObjectSuiteDeclaration;
  readonly handle: (
    family: string,
    role: FixtureRole,
    fixtureCase: Record<string, unknown>,
    section: string | undefined,
  ) => HandlerResult | Promise<HandlerResult>;
  /** Streams default to the process stdio; overridable for tests. */
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

/**
 * Runs the adapter loop until the runner sends `end` or the input closes.
 * Resolves with the process exit code the caller should use.
 */
export function createStdioAdapter(options: StdioAdapterOptions): Promise<number> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const families = [...options.families];

  const write = (message: unknown): void => {
    output.write(`${JSON.stringify(message)}\n`);
  };

  return new Promise<number>((resolve) => {
    const rl = createInterface({ input, crlfDelay: Infinity });
    // Serializes async handlers so results are emitted in the order received.
    let chain: Promise<void> = Promise.resolve();
    let exitCode = 0;

    const finish = (): void => {
      rl.close();
      resolve(exitCode);
    };

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed === '') return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        process.stderr.write(`adapter: unparseable line\n`);
        exitCode = 2;
        finish();
        return;
      }

      if (message.type === 'hello') {
        if (message.protocol !== CONFORMANCE_PROTOCOL_VERSION) {
          process.stderr.write(`adapter: unsupported protocol ${String(message.protocol)}\n`);
          exitCode = 2;
          finish();
          return;
        }
        write({
          type: 'hello',
          protocol: CONFORMANCE_PROTOCOL_VERSION,
          implementation: options.implementation,
          version: options.version,
          language: options.language,
          families,
          ...(options.hostileObjectSuite
            ? { hostileObjectSuite: options.hostileObjectSuite }
            : {}),
        });
        return;
      }

      if (message.type === 'end') {
        chain = chain.then(finish);
        return;
      }

      if (message.type === 'case') {
        const seq = message.seq as number;
        const family = message.family as string;
        const role = message.role as FixtureRole;
        const fixtureCase = message.case as Record<string, unknown>;
        const section = message.section as string | undefined;
        chain = chain.then(async () => {
          const result = await options.handle(family, role, fixtureCase, section);
          write({ type: 'result', seq, ...result });
        });
        return;
      }

      process.stderr.write(`adapter: unknown message type ${String(message.type)}\n`);
    });

    input.on('error', () => {
      exitCode = 2;
      finish();
    });
  });
}
