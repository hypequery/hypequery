export interface StdoutRedirect {
  /** Write to the real stdout, bypassing the redirect. */
  writeStdout(text: string): void;
  /** Restore stdout and the console methods. Idempotent. */
  restore(): void;
}

/**
 * Send everything written to stdout to stderr instead, until `restore()`.
 * Covers direct stream writes and the console methods that print to stdout,
 * so logs never mix with a command's machine-readable stdout.
 */
export function redirectStdoutToStderr(): StdoutRedirect {
  const write = process.stdout.write;
  const { log, info, debug } = console;
  const realWrite = write.bind(process.stdout) as (text: string) => boolean;
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);
  let restored = false;
  return {
    writeStdout(text) { realWrite(text); },
    restore() {
      if (restored) return;
      restored = true;
      process.stdout.write = write;
      Object.assign(console, { log, info, debug });
    },
  };
}

/**
 * Run `task` with everything written to stdout sent to stderr instead, so
 * startup logs from user code never mix with a command's machine-readable
 * stdout. Restores both even when `task` throws.
 */
export async function withStdoutToStderr<T>(task: () => Promise<T>): Promise<T> {
  const redirect = redirectStdoutToStderr();
  try {
    return await task();
  } finally {
    redirect.restore();
  }
}
