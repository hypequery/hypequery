export interface HttpClientOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
}

export interface HypequeryHttpError extends Error {
  status: number;
  body: unknown;
}

const defaultFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;

function buildUrl(baseUrl: string, name: string) {
  if (!baseUrl) {
    throw new Error('baseUrl is required');
  }
  return baseUrl.endsWith('/') ? `${baseUrl}${name}` : `${baseUrl}/${name}`;
}

async function parseResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createHttpClient({ baseUrl, fetchFn, headers = {} }: HttpClientOptions) {
  const runtimeFetch = fetchFn ?? defaultFetch;
  if (!runtimeFetch) {
    throw new Error('A fetch implementation is required. Provide config.fetchFn in createHooks.');
  }

  const request = async (name: string, input: unknown) => {
    const url = buildUrl(baseUrl, name);
    const res = await runtimeFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    });

    if (!res.ok) {
      const errorBody = await parseResponse(res);
      const error = new Error('Request failed') as HypequeryHttpError;
      error.status = res.status;
      error.body = errorBody;
      throw error;
    }

    return res.json();
  };

  return {
    runQuery: request,
    runMutation: request,
  };
}
