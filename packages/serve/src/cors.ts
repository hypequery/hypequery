import type { CorsConfig, ServeRequest, ServeResponse } from './types.js';

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const DEFAULT_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Request-ID'];
const DEFAULT_MAX_AGE = 86400; // 24 hours

export interface ResolvedCorsConfig {
  origin: string | string[] | ((origin: string) => boolean);
  methods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  credentials: boolean;
  maxAge: number;
}

export const resolveCorsConfig = (
  config: boolean | CorsConfig | undefined,
): ResolvedCorsConfig | null => {
  if (!config) return null;

  const opts: CorsConfig = config === true ? {} : config;

  return {
    origin: opts.origin ?? '*',
    methods: opts.methods ?? DEFAULT_METHODS,
    allowedHeaders: opts.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS,
    exposedHeaders: opts.exposedHeaders ?? [],
    credentials: opts.credentials ?? false,
    maxAge: opts.maxAge ?? DEFAULT_MAX_AGE,
  };
};

const matchOrigin = (
  config: ResolvedCorsConfig,
  requestOrigin: string | undefined,
): string | null => {
  if (!requestOrigin) return null;

  const { origin } = config;

  if (origin === '*') {
    // When credentials are enabled, we must echo the origin instead of "*"
    return config.credentials ? requestOrigin : '*';
  }

  if (typeof origin === 'string') {
    return origin === requestOrigin ? origin : null;
  }

  if (Array.isArray(origin)) {
    return origin.includes(requestOrigin) ? requestOrigin : null;
  }

  if (typeof origin === 'function') {
    return origin(requestOrigin) ? requestOrigin : null;
  }

  return null;
};

export const buildCorsHeaders = (
  config: ResolvedCorsConfig,
  requestOrigin: string | undefined,
): Record<string, string> => {
  const headers: Record<string, string> = {};
  const allowedOrigin = matchOrigin(config, requestOrigin);

  if (!allowedOrigin) return headers;

  headers['access-control-allow-origin'] = allowedOrigin;

  if (allowedOrigin !== '*') {
    headers['vary'] = 'Origin';
  }

  if (config.credentials) {
    headers['access-control-allow-credentials'] = 'true';
  }

  if (config.exposedHeaders.length > 0) {
    headers['access-control-expose-headers'] = config.exposedHeaders.join(', ');
  }

  return headers;
};

export const buildPreflightHeaders = (
  config: ResolvedCorsConfig,
  requestOrigin: string | undefined,
): Record<string, string> => {
  const headers = buildCorsHeaders(config, requestOrigin);

  // No matching origin → don't add preflight headers
  if (!headers['access-control-allow-origin']) return headers;

  headers['access-control-allow-methods'] = config.methods.join(', ');
  headers['access-control-allow-headers'] = config.allowedHeaders.join(', ');
  headers['access-control-max-age'] = String(config.maxAge);

  return headers;
};

export const handleCorsRequest = (
  config: ResolvedCorsConfig | null,
  request: ServeRequest,
): { preflightResponse: ServeResponse | null; corsHeaders: Record<string, string> } => {
  if (!config) {
    return { preflightResponse: null, corsHeaders: {} };
  }

  const requestOrigin = request.headers['origin'];

  if (request.method === 'OPTIONS') {
    return {
      preflightResponse: {
        status: 204,
        headers: buildPreflightHeaders(config, requestOrigin),
        body: '',
      },
      corsHeaders: {},
    };
  }

  return {
    preflightResponse: null,
    corsHeaders: buildCorsHeaders(config, requestOrigin),
  };
};
