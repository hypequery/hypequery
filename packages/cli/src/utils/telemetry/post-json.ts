import http from 'node:http';
import https from 'node:https';

/** Posts a telemetry body and resolves the HTTP status; a pending send never delays exit. */
export type PostJson = (url: URL, body: string, signal: AbortSignal) => Promise<number>;

/**
 * Built-in fetch is not used: aborting it rejects on time, but its in-progress
 * TCP or TLS connect keeps the process alive until the connect timeout (about
 * 10 s for an unreachable host). Here abort destroys the socket, including
 * mid-connect, so the CLI exits once the bounded flush returns. The socket stays
 * referenced until then: unreferencing it would let the process exit before a
 * remote endpoint even connects, silently dropping events within the budget.
 * Node's client never follows redirects, so a 3xx response is simply returned.
 */
export const postJson: PostJson = (url, body, signal) => new Promise((resolve, reject) => {
  const client = url.protocol === 'https:' ? https : http;
  const request = client.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    agent: false,
  }, response => {
    resolve(response.statusCode ?? 0);
    response.resume();
    request.destroy();
  });
  const abort = () => request.destroy(new Error('Telemetry request aborted'));
  if (signal.aborted) { abort(); return; }
  signal.addEventListener('abort', abort, { once: true });
  request.on('error', reject);
  request.on('close', () => signal.removeEventListener('abort', abort));
  request.end(body);
});
