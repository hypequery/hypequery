import type {
  QueryHistoryEntry,
  QueryListResult,
  QueryFilters,
  LoggerStats,
  GatewayMeta,
  RegistryResult,
  ExecuteResult,
} from './types';

/**
 * Base path for the gateway contract. Overridable so the same studio bundle
 * can front the local gateway (same-origin `/__dev`) or a hosted Cloud gateway
 * (an absolute origin). Set once at boot via {@link setGatewayBaseUrl}.
 */
let BASE_URL = '/__dev';

/** Point the studio at a specific gateway (e.g. Cloud). Defaults to `/__dev`. */
export function setGatewayBaseUrl(baseUrl: string): void {
  BASE_URL = baseUrl.replace(/\/$/, '');
}

/** The SSE endpoint for the configured gateway. */
export function gatewayEventsUrl(): string {
  return `${BASE_URL}/events`;
}

/**
 * API client error.
 */
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * Make a request to the dev API.
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let details: unknown;
    let message = `API request failed: ${response.statusText}`;
    // Read the body once as text: response.json() consumes the stream, so a
    // non-JSON body (e.g. an HTML error page) would make a follow-up text()
    // throw "body stream already read" and mask the real HTTP error.
    const bodyText = await response.text().catch(() => '');
    try {
      details = bodyText ? JSON.parse(bodyText) : undefined;
      if (
        details &&
        typeof details === 'object' &&
        'error' in details &&
        typeof (details as { error?: unknown }).error === 'string'
      ) {
        message = (details as { error: string }).error;
      }
    } catch {
      details = bodyText;
      if (bodyText) {
        message = bodyText;
      }
    }
    throw new APIError(
      message,
      response.status,
      details
    );
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

/**
 * API client for the dev server.
 */
export const apiClient = {
  /** Discovery: contract version + advertised capabilities. */
  async getMeta(): Promise<GatewayMeta> {
    return request<GatewayMeta>('/meta');
  },

  /** Endpoint catalog (queries + semantic dataset/metric routes). */
  async getRegistry(): Promise<RegistryResult> {
    return request<RegistryResult>('/registry');
  },

  /** Run an endpoint through the serve pipeline. */
  async execute(key: string, input?: unknown): Promise<ExecuteResult> {
    return request<ExecuteResult>('/execute', {
      method: 'POST',
      body: JSON.stringify({ key, input }),
    });
  },

  /**
   * Get list of queries with optional filters.
   */
  async getQueries(filters: QueryFilters = {}): Promise<QueryListResult> {
    const params = new URLSearchParams();

    if (filters.status) params.set('status', filters.status);
    if (filters.endpointKey) params.set('endpointKey', filters.endpointKey);
    if (filters.cacheHit !== undefined) params.set('cacheHit', String(filters.cacheHit));
    if (filters.search) params.set('search', filters.search);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));

    const query = params.toString();
    return request<QueryListResult>(`/history${query ? `?${query}` : ''}`);
  },

  /**
   * Get a single query by ID.
   */
  async getQuery(queryId: string): Promise<QueryHistoryEntry> {
    return request<QueryHistoryEntry>(`/history/${encodeURIComponent(queryId)}`);
  },

  /**
   * Clear query history.
   */
  async clearHistory(): Promise<{ cleared: number }> {
    return request<{ cleared: number }>('/history', { method: 'DELETE' });
  },

  /**
   * Get logger statistics.
   */
  async getLoggerStats(): Promise<LoggerStats> {
    return request<LoggerStats>('/logger/stats');
  },

  /**
   * Export query history.
   */
  async exportHistory(): Promise<QueryHistoryEntry[]> {
    const response = await fetch(`${BASE_URL}/history/export`);
    if (!response.ok) {
      throw new APIError('Export failed', response.status);
    }
    return response.json();
  },

  /**
   * Import query history.
   */
  async importHistory(data: QueryHistoryEntry[]): Promise<{ imported: number }> {
    return request<{ imported: number }>('/history/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

};

export default apiClient;
