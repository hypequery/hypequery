import { postJson, type PostJson } from './post-json.js';

/** Runs in the detached sender, so this budget never delays the CLI's own exit. */
export const DELIVERY_TIMEOUT_MS = 5_000;

export interface DeliveryOptions {
  /** Injectable for tests; defaults to an exit-safe node:http(s) POST. */
  readonly post?: PostJson;
  readonly timeoutMs?: number;
  /** The proxy owns the real PostHog API key. 410 disables this CLI version. */
  readonly onDisabled?: () => Promise<unknown>;
}

/** One bounded attempt with no retries; every failure is swallowed. */
export async function deliverBatch(url: URL, body: string, options: DeliveryOptions = {}): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  try {
    const timeout = new Promise<void>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(); }, options.timeoutMs ?? DELIVERY_TIMEOUT_MS);
      timer.unref();
    });
    const request = (async () => {
      const status = await (options.post ?? postJson)(url, body, controller.signal);
      if (status === 410 && !controller.signal.aborted) await options.onDisabled?.();
    })().catch(() => undefined);
    await Promise.race([request, timeout]);
  } catch { /* DNS/TLS/HTTP/abort/synchronous failures are dropped. */ }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}
