/**
 * Dev UI API Endpoints
 *
 * This module re-exports all endpoint handlers organized by domain.
 * Each domain is in its own file for maintainability.
 */

// Types
export type { EndpointContext, ApiInstance, EndpointDefinition, RegistryEntry } from './types.js';

// Helpers
export { parseQueryParams, parseBody, sendJSON, sendError } from './helpers.js';

// Query endpoints
export { getQueries, getQuery } from './query-endpoints.js';

// Cache endpoints
export { getCacheStats, invalidateCache, clearCache } from './cache-endpoints.js';

// Registry endpoints
export { getRegistry, getAvailableQueries } from './registry-endpoints.js';

// Logger endpoints
export { getLoggerStats } from './logger-endpoints.js';

// History endpoints
export { clearHistory, exportHistory, importHistory } from './history-endpoints.js';

// Playground endpoints
export { getPlaygroundQueries, executePlaygroundQuery } from './playground-endpoints.js';
