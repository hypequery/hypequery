/**
 * API module for dev server endpoints.
 * Provides SSE handler, REST endpoints, and API router.
 */

// SSE Handler
export { SSEHandler } from './sse-handler.js';
export type { SSEEvent } from './sse-handler.js';

// REST Endpoints
export {
  getQueries,
  getQuery,
  getCacheStats,
  invalidateCache,
  clearCache,
  getAvailableQueries,
  getLoggerStats,
  clearHistory,
  exportHistory,
  importHistory,
  parseQueryParams,
  parseBody,
  sendJSON,
  sendError
} from './endpoints.js';
export type { EndpointContext } from './endpoints.js';

// Router
export { DevAPIRouter, createDevRouter } from './router.js';
export type { RouterOptions } from './router.js';
