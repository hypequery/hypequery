// Re-export everything from @hypequery/datasets
export * from '@hypequery/datasets';

// Serve-specific endpoint integration
export { createMetricEndpoint } from './metric-endpoint.js';
export { createDatasetEndpoint } from './dataset-endpoint.js';
export type { DatasetEntry } from './dataset-endpoint.js';
