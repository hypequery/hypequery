export interface CloseableMcpServer {
  close(): Promise<void>;
}

/** Own signal listeners for exactly the lifetime of the stdio server. */
export async function runMcpUntilSignal(start: () => Promise<CloseableMcpServer>): Promise<void> {
  let stop!: () => void;
  const stopped = new Promise<void>(resolve => { stop = resolve; });
  // Install before awaiting startup so a signal during connection is retained.
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let server: CloseableMcpServer | undefined;
  try {
    server = await start();
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
