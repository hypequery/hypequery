import type {
  QueryHistoryEntry,
  QueryListResult,
  QueryFilters,
  CacheStats,
  LoggerStats,
  AvailableEndpoint,
} from './types';

/**
 * Base URL for the dev API.
 */
const BASE_URL = '/__dev';

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
    try {
      details = await response.json();
    } catch {
      details = await response.text();
    }
    throw new APIError(
      `API request failed: ${response.statusText}`,
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
    return request<QueryListResult>(`/queries${query ? `?${query}` : ''}`);
  },

  /**
   * Get a single query by ID.
   */
  async getQuery(queryId: string): Promise<QueryHistoryEntry> {
    return request<QueryHistoryEntry>(`/queries/${encodeURIComponent(queryId)}`);
  },

  /**
   * Get available API endpoints.
   */
  async getAvailableEndpoints(): Promise<{ endpoints: AvailableEndpoint[] }> {
    return request<{ endpoints: AvailableEndpoint[] }>('/queries/available');
  },

  /**
   * Clear query history.
   */
  async clearHistory(): Promise<{ cleared: number }> {
    return request<{ cleared: number }>('/queries', { method: 'DELETE' });
  },

  /**
   * Get cache statistics.
   */
  async getCacheStats(): Promise<CacheStats> {
    return request<CacheStats>('/cache/stats');
  },

  /**
   * Invalidate cache keys.
   */
  async invalidateCache(keys: string[]): Promise<{ invalidated: number }> {
    return request<{ invalidated: number }>('/cache/invalidate', {
      method: 'POST',
      body: JSON.stringify({ keys }),
    });
  },

  /**
   * Clear all cache.
   */
  async clearCache(): Promise<{ success: boolean }> {
    return request<{ success: boolean }>('/cache/clear', { method: 'POST' });
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
    const response = await fetch(`${BASE_URL}/export`);
    if (!response.ok) {
      throw new APIError('Export failed', response.status);
    }
    return response.json();
  },

  /**
   * Import query history.
   */
  async importHistory(data: QueryHistoryEntry[]): Promise<{ imported: number }> {
    return request<{ imported: number }>('/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

export default apiClient;
