import { createSlackDispatcher, type SlackHandlers, type SlackRetryInfo } from './dispatch.js';
import { parseSlackBody } from './events.js';
import { verifySlackRequest } from './verify.js';

export interface SlackRequestHandlerOptions extends SlackHandlers {
  /** The app's Signing Secret (Basic Information → App Credentials). */
  signingSecret: string;
  /**
   * Keeps background work alive after the response is sent. Pass the
   * platform's own: Next.js `after`, Vercel `waitUntil`, or a Workers
   * `ctx.waitUntil`. Without it the work runs as a plain promise, which is
   * fine on a long-running server but may be frozen on serverless.
   */
  waitUntil?: (work: Promise<unknown>) => void;
  /** Largest body accepted, in bytes. @default 1_000_000 */
  maxBodyBytes?: number;
}

/**
 * A Fetch API handler for Slack's Events API, interactivity and slash
 * commands: `(request: Request) => Promise<Response>`. Mount it on one URL
 * (for example `POST /slack/events`) and point all three Request URLs at it.
 *
 * It verifies the signature, answers `url_verification`, acks every valid
 * request at once (Slack retries anything slower than 3 seconds), and runs
 * your handlers afterwards, once per event id.
 */
export function createSlackRequestHandler(options: SlackRequestHandlerOptions): (request: Request) => Promise<Response> {
  if (!options.signingSecret) throw new TypeError('createSlackRequestHandler: signingSecret is required');
  const dispatch = createSlackDispatcher(options);
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  const schedule = options.waitUntil ?? ((work: Promise<unknown>) => void work);

  return async function handleSlackRequest(request: Request): Promise<Response> {
    if (request.method !== 'POST') return text(405, 'Method Not Allowed', { allow: 'POST' });

    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (declaredLength > maxBodyBytes) return text(413, 'Payload Too Large');
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maxBodyBytes) return text(413, 'Payload Too Large');

    const verification = await verifySlackRequest({
      signingSecret: options.signingSecret,
      body,
      timestamp: request.headers.get('x-slack-request-timestamp'),
      signature: request.headers.get('x-slack-signature'),
    });
    if (!verification.ok) return text(401, 'Unauthorized');

    const parsed = parseSlackBody(body, request.headers.get('content-type'));
    if (parsed.type === 'url_verification') {
      return new Response(JSON.stringify({ challenge: parsed.challenge }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const work = await dispatch(parsed, retryInfo(request.headers));
    if (work) schedule(work());
    return new Response(null, { status: 200 });
  };
}

function retryInfo(headers: Headers): SlackRetryInfo | null {
  const attempt = headers.get('x-slack-retry-num');
  if (attempt === null) return null;
  return { attempt: Number(attempt) || 0, reason: headers.get('x-slack-retry-reason') };
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain', ...headers } });
}
