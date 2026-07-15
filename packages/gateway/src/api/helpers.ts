import type { IncomingMessage, ServerResponse } from 'http';

/** Maximum request body size (1MB) to prevent DoS attacks */
const MAX_BODY_SIZE = 1024 * 1024;

/**
 * Parse query parameters from URL.
 * Handles edge cases like multiple `=` signs and malformed encoding.
 */
export function parseQueryParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const queryString = url.split('?')[1];

  if (!queryString) return params;

  for (const param of queryString.split('&')) {
    const eqIndex = param.indexOf('=');
    const key = eqIndex === -1 ? param : param.slice(0, eqIndex);
    const value = eqIndex === -1 ? '' : param.slice(eqIndex + 1);

    if (key) {
      try {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch {
        continue;
      }
    }
  }

  return params;
}

/**
 * Parse request body as JSON.
 * Enforces a size limit to prevent denial-of-service attacks.
 */
export async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Send JSON response.
 */
export function sendJSON(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send error response.
 */
export function sendError(res: ServerResponse, message: string, status = 500): void {
  sendJSON(res, { error: message }, status);
}
