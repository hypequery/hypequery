// Re-export everything from @hypequery/semantic
export * from '@hypequery/semantic';

// Serve-specific endpoint integration
export { createMetricEndpoint } from './metric-endpoint.js';
export { createDatasetEndpoint } from './dataset-endpoint.js';
export type { DatasetEntry } from './dataset-endpoint.js';
