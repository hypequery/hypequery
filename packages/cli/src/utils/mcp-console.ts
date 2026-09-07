import { format } from 'node:util';

/**
 * MCP speaks its protocol over stdout, so anything an application logs while
 * loading would corrupt the stream. Route it to stderr before importing the
 * entrypoint, not after.
 */
export function routeConsoleOutputToStderr(): () => void {
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
  };
  const write = (...args: unknown[]) => {
    process.stderr.write(`${format(...args)}\n`);
  };
  console.log = write;
  console.info = write;
  console.debug = write;
  return () => Object.assign(console, original);
}

