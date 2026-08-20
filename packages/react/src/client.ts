import { HttpError } from './errors.js';

export type ApiContract = Record<string, { input: any; output: any }>;

export interface QueryMethodConfig {
  method?: string;
  path?: string;
}

export interface RouteManifestEntry {
  method?: string;
  path?: string;
}

export type RouteManifest = Record<string, RouteManifestEntry>;

type HeaderMap = Record<string, string | undefined>;
export type HeadersInput = HeaderMap | (() => HeaderMap | Promise<HeaderMap>);
export type TokenInput = string | (() => string | undefined | Promise<string | undefined>);

export interface HypequeryClientConfig<Api extends ApiContract = ApiContract> {
  baseUrl: string;
  fetchFn?: typeof fetch;
  headers?: HeadersInput;
  /** A bearer token or per-request token resolver. Never put a server API key in browser code. */
  token?: TokenInput;
  config?: Record<string, QueryMethodConfig>;
  manifest?: RouteManifest;
  /** Refresh authentication state after a 401. The request is retried once. */
  onUnauthorized?: () => void | Promise<void>;
  api?: Api;
}

const normalizeMethodConfig = (source?: Record<string, { method?: string; path?: string }>) => {
  if (!source) return {};
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, { method: value.method ?? 'GET', path: value.path }])
  );
};

const deriveMethodConfig = (api: unknown): Record<string, QueryMethodConfig> => {
  if (typeof api !== 'object' || api === null) return {};

  if (typeof (api as Record<string, unknown>).manifest === 'function') {
    const manifest = (api as { manifest: () => RouteManifest }).manifest();
    if (manifest && typeof manifest === 'object') return normalizeMethodConfig(manifest);
  }

  if (
    '_routeConfig' in api &&
    typeof (api as Record<string, unknown>)._routeConfig === 'object' &&
    (api as Record<string, unknown>)._routeConfig !== null
  ) {
    return normalizeMethodConfig((api as Record<string, Record<string, { method?: string }>>)._routeConfig);
  }

  if (
    'queries' in api &&
    typeof (api as Record<string, unknown>).queries === 'object' &&
    (api as Record<string, unknown>).queries !== null
  ) {
    return normalizeMethodConfig((api as Record<string, Record<string, { method?: string }>>).queries);
  }

  return {};
};

const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//.test(value);
const ensureTrailingSlash = (value: string) => value.endsWith('/') ? value : `${value}/`;

const buildUrl = (baseUrl: string, name: string, path?: string) => {
  if (path) {
    if (isAbsoluteHttpUrl(path)) return path;
    if (isAbsoluteHttpUrl(baseUrl)) return new URL(path, ensureTrailingSlash(baseUrl)).toString();
    if (path.startsWith('/')) return path;
    if (!baseUrl) throw new Error('baseUrl is required');
    return `${ensureTrailingSlash(baseUrl)}${path}`;
  }
  if (!baseUrl) throw new Error('baseUrl is required');
  return `${ensureTrailingSlash(baseUrl)}${name}`;
};

const parseResponse = async (response: Response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const resolveHeaders = async (headers?: HeadersInput): Promise<Record<string, string>> => {
  if (!headers) return {};
  const raw = typeof headers === 'function' ? await headers() : headers;
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)) as Record<string, string>;
};

const resolveToken = async (token?: TokenInput) =>
  typeof token === 'function' ? token() : token;

export interface HypequeryClient<Api extends ApiContract = ApiContract> {
  readonly config: Readonly<HypequeryClientConfig<Api>>;
  request(name: string, input?: unknown, defaultMethod?: string, extraHeaders?: Record<string, string>): Promise<unknown>;
}

export function createHypequeryClient<Api extends ApiContract = ApiContract>(
  config: HypequeryClientConfig<Api>,
): HypequeryClient<Api> {
  const {
    baseUrl,
    fetchFn = fetch,
    headers,
    token,
    config: explicitConfig = {},
    manifest,
    onUnauthorized,
    api,
  } = config;
  const finalConfig = {
    ...deriveMethodConfig(api),
    ...(manifest ? normalizeMethodConfig(manifest) : {}),
    ...explicitConfig,
  };

  const request = async (
    name: string,
    input?: unknown,
    defaultMethod = 'GET',
    extraHeaders?: Record<string, string>,
  ) => {
    const methodConfig = finalConfig[name];
    if (name.includes(':') && !methodConfig?.path) {
      throw new Error(
        `No route configured for "${name}". Pass \`manifest\` (from the serve ` +
        `api.manifest()) or an explicit \`config\` entry to createHypequeryClient().`
      );
    }

    const url = buildUrl(baseUrl, name, methodConfig?.path);
    const method = methodConfig?.method ?? defaultMethod;
    let finalUrl = url;
    let body: string | undefined;

    if (method === 'GET' && input && typeof input === 'object') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) value.forEach((item) => params.append(key, String(item)));
        else params.append(key, String(value));
      }
      const queryString = params.toString();
      finalUrl = queryString ? `${url}?${queryString}` : url;
    } else if (input !== undefined) {
      body = JSON.stringify(input);
    }

    const attempt = async () => {
      const [resolvedHeaders, resolvedToken] = await Promise.all([
        resolveHeaders(headers),
        resolveToken(token),
      ]);
      return fetchFn(finalUrl, {
        method,
        headers: {
          ...resolvedHeaders,
          ...(resolvedToken ? { authorization: `Bearer ${resolvedToken}` } : {}),
          ...(extraHeaders ?? {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body,
      });
    };

    let response = await attempt();
    if (response.status === 401 && onUnauthorized) {
      await onUnauthorized();
      response = await attempt();
    }
    if (!response.ok) {
      const errorBody = await parseResponse(response);
      throw new HttpError(
        `${method} request to ${finalUrl} failed with status ${response.status}`,
        response.status,
        errorBody,
      );
    }
    return response.json();
  };

  return Object.freeze({ config: Object.freeze({ ...config }), request });
}
