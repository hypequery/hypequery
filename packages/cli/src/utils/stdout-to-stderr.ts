/**
 * Run `task` with everything written to stdout sent to stderr instead, so
 * startup logs from user code never mix with a command's machine-readable
 * stdout. Covers direct stream writes and the console methods that print to
 * stdout. Restores both even when `task` throws.
 */
export async function withStdoutToStderr<T>(task: () => Promise<T>): Promise<T> {
  const write = process.stdout.write;
  const { log, info, debug } = console;
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);
  try {
    return await task();
  } finally {
    process.stdout.write = write;
    Object.assign(console, { log, info, debug });
  }
}
