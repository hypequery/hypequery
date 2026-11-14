import { normalizeSlackEvent, type SlackEventEnvelope, type SlackInboundEvent, type SlackRequestBody, type SlackSlashCommand } from './events.js';

/** Remembers which event ids were already handled, so Slack's retries run once. */
export interface SlackEventDedupe {
  /** Returns `true` the first time a key is seen and `false` afterwards. */
  claim(key: string): boolean | Promise<boolean>;
}

/**
 * An in-process dedupe. Enough for one long-running process (Socket Mode, a
 * single server). With several instances or serverless, pass a shared store
 * (a database row or Redis `SET NX`) instead.
 */
export function createMemoryDedupe(options: { ttlMs?: number; maxEntries?: number } = {}): SlackEventDedupe {
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 10_000;
  const seen = new Map<string, number>();
  return {
    claim(key) {
      const now = Date.now();
      const expiresAt = seen.get(key);
      if (expiresAt !== undefined && expiresAt > now) return false;
      seen.delete(key);
      seen.set(key, now + ttlMs);
      // A Map iterates in insertion order, so the first keys are the oldest.
      for (const oldKey of seen.keys()) {
        if (seen.size <= maxEntries) break;
        seen.delete(oldKey);
      }
      return true;
    },
  };
}

/** Why Slack resent a request (`X-Slack-Retry-Num` / `X-Slack-Retry-Reason`, or Socket Mode's `retry_attempt`). */
export interface SlackRetryInfo {
  attempt: number;
  reason: string | null;
}

export interface SlackEventContext {
  envelope: SlackEventEnvelope;
  retry: SlackRetryInfo | null;
}

export interface SlackHandlers {
  /** Called once per event id, after Slack has been acked. Ignored events are not passed. */
  onEvent?: (event: Exclude<SlackInboundEvent, { kind: 'ignored' }>, context: SlackEventContext) => unknown;
  /** Block actions, view submissions and other interactions, after Slack has been acked. */
  onInteraction?: (payload: Record<string, unknown>) => unknown;
  /** Slash commands, after Slack has been acked. Reply through `command.response_url`. */
  onCommand?: (command: SlackSlashCommand) => unknown;
  /** Errors thrown by a handler. @default console.error */
  onError?: (error: unknown, context: { eventId?: string }) => void;
  /** @default createMemoryDedupe() */
  dedupe?: SlackEventDedupe;
}

/**
 * Decide what to do with a verified, parsed body. Returns the background work
 * to run after the transport has acked Slack, or `null` when there is none.
 * Shared by the HTTP handler and Socket Mode.
 */
export function createSlackDispatcher(handlers: SlackHandlers) {
  const dedupe = handlers.dedupe ?? createMemoryDedupe();
  const onError = handlers.onError ?? ((error: unknown) => console.error('[hypequery/slack]', error));

  const guarded = (eventId: string | undefined, fn: () => unknown) => async () => {
    try {
      await fn();
    } catch (error) {
      onError(error, { eventId });
    }
  };

  return async function dispatch(
    body: SlackRequestBody,
    retry: SlackRetryInfo | null,
  ): Promise<(() => Promise<void>) | null> {
    switch (body.type) {
      case 'event': {
        const { onEvent } = handlers;
        if (!onEvent) return null;
        const event = normalizeSlackEvent(body.envelope);
        if (event.kind === 'ignored') return null;
        if (!(await dedupe.claim(`event:${event.eventId}`))) return null;
        return guarded(event.eventId, () => onEvent(event, { envelope: body.envelope, retry }));
      }
      case 'interaction': {
        const { onInteraction } = handlers;
        return onInteraction ? guarded(undefined, () => onInteraction(body.payload)) : null;
      }
      case 'command': {
        const { onCommand } = handlers;
        return onCommand ? guarded(undefined, () => onCommand(body.command)) : null;
      }
      default:
        return null;
    }
  };
}
