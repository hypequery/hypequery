/** Read a JSON-RPC response, including responses delivered over an SSE stream. */
export async function readMcpResponse(
  response: Response,
  requestId: unknown,
): Promise<Record<string, any> | null> {
  if (!response.ok || requestId === undefined) {
    await response.body?.cancel();
    return null;
  }
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'text/event-stream') {
    try {
      const body = await response.json() as Record<string, any> | null;
      return body?.jsonrpc === '2.0' && body.id === requestId ? body : null;
    } catch (error) {
      if ((error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError') {
        throw error;
      }
      return null;
    }
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let data: string[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      let newline: RegExpExecArray | null;
      while ((newline = /\r\n|\r|\n/.exec(pending))) {
        // A CR at the chunk boundary may be the first half of CRLF.
        if (!chunk.done && newline[0] === '\r' && newline.index === pending.length - 1) break;
        const line = pending.slice(0, newline.index);
        pending = pending.slice(newline.index + newline[0].length);
        if (line === '') {
          if (data.length > 0) {
            const body = JSON.parse(data.join('\n'));
            data = [];
            if (body?.jsonrpc === '2.0' && body.id === requestId
              && ('result' in body || 'error' in body)) return body;
          }
        } else if (line === 'data' || line.startsWith('data:')) {
          data.push(line === 'data' ? '' : line.slice(5).replace(/^ /, ''));
        }
      }
      if (chunk.done) return null;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
