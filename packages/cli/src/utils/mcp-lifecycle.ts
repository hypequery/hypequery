export interface CloseableMcpServer {
  close(): Promise<void>;
}

/** Own signal listeners for exactly the lifetime of the stdio server. */
export async function runMcpUntilSignal(start: (signal: AbortSignal) => Promise<CloseableMcpServer>): Promise<void> {
  const controller = new AbortController();
  let stop!: () => void;
  const stopped = new Promise<void>(resolve => { stop = () => { controller.abort(); resolve(); }; });
  // Install before awaiting startup so a signal during connection is retained.
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let server: CloseableMcpServer | undefined;
  try {
    try { server = await start(controller.signal); }
    catch (error) { if (controller.signal.aborted && error === controller.signal.reason) return; throw error; }
    await stopped;
  } finally {
    try {
      await server?.close();
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
}
