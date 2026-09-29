import { readMcpResponse } from './mcp-response.js';

const PROTOCOL_VERSION = '2025-06-18';
const TIMEOUT_MS = 15_000;
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-03-26', PROTOCOL_VERSION, '2025-11-25']);

export type RemoteMcpCheck =
  | { readonly ok: true; readonly tools: number; readonly server?: string }
  | { readonly ok: false; readonly reason: string };

async function rpc(
  fetchFn: typeof fetch,
  url: string,
  key: string,
  message: Record<string, unknown>,
  session?: string,
  protocolVersion = PROTOCOL_VERSION,
) {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': protocolVersion,
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(message),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await readMcpResponse(response, message.id);
  return { response, body };
}

function refusal(status: number): string {
  if (status === 401) return 'the API key was refused (401). Check HYPEQUERY_API_KEY.';
  if (status === 403) return 'the API key may not use MCP here (403). Check its scopes.';
  if (status === 404) return 'no MCP endpoint is published at this URL (404).';
  return `the endpoint answered HTTP ${status}.`;
}

/**
 * A non-destructive check of a hosted MCP endpoint: initialize, then list
 * tools. It never calls a tool, so it runs no query and changes nothing.
 * The key is sent only as a bearer header and never included in the result.
 */
export async function checkRemoteMcp(input: {
  readonly url: string;
  readonly key: string;
  readonly fetch?: typeof fetch;
}): Promise<RemoteMcpCheck> {
  const fetchFn = input.fetch ?? fetch;
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { ok: false, reason: 'the URL is not valid.' };
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    return { ok: false, reason: 'the URL must use https, so the API key is not sent in the clear.' };
  }

  try {
    const init = await rpc(fetchFn, url.href, input.key, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'hypequery-cli-self-test', version: '1.0.0' },
      },
    });
    if (!init.response.ok) return { ok: false, reason: refusal(init.response.status) };
    if (!init.body?.result) return { ok: false, reason: 'initialize returned no result.' };
    const protocolVersion = init.body.result.protocolVersion;
    if (typeof protocolVersion !== 'string' || !SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion)) {
      return { ok: false, reason: 'initialize returned an unsupported protocol version.' };
    }
    const session = init.response.headers.get('mcp-session-id') ?? undefined;
    const initialized = await rpc(fetchFn, url.href, input.key, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }, session, protocolVersion);
    if (!initialized.response.ok) return { ok: false, reason: refusal(initialized.response.status) };
    const listed = await rpc(fetchFn, url.href, input.key, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    }, session, protocolVersion);
    if (!listed.response.ok) return { ok: false, reason: refusal(listed.response.status) };
    const tools = listed.body?.result?.tools;
    if (!Array.isArray(tools)) return { ok: false, reason: 'tools/list returned no tools.' };
    const server = init.body.result.serverInfo?.name;
    return { ok: true, tools: tools.length, ...(typeof server === 'string' ? { server } : {}) };
  } catch (error) {
    return {
      ok: false,
      reason: (error as Error)?.name === 'TimeoutError'
        ? 'the endpoint did not answer in time.'
        : 'the endpoint could not be reached.',
    };
  }
}
