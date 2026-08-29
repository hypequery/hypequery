import {
  type AuthTemplateMode,
  CONTEXT_AUTH_TENANT_COLUMN,
} from './auth-scaffold.js';

/**
 * Generate placeholder datasets.ts file for no-connection init.
 */
export function generateDatasetsPlaceholderTemplate(
  options: { auth?: AuthTemplateMode } = {},
): string {
  // Context auth wires a trusted runtime tenant scope in api.ts, and tenant-scoped
  // dataset requests fail unless the dataset declares the matching tenantKey.
  const tenantScoped = options.auth === 'context';
  const tenantKeyLine = tenantScoped
    ? `  tenantKey: '${CONTEXT_AUTH_TENANT_COLUMN}',\n`
    : '';
  const tenantDimensionLine = tenantScoped
    ? `    tenantId: dimension.string({ column: '${CONTEXT_AUTH_TENANT_COLUMN}' }),\n`
    : '';

  return `import { dataset, dimension, measure } from '@hypequery/datasets';

const exampleEvents = dataset('example_events', {
  source: 'example_events',
  timeKey: 'created_at',
${tenantKeyLine}  dimensions: {
    id: dimension.string(),
${tenantDimensionLine}    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    eventCount: measure.count('id', { label: 'Event Count' }),
  },
});

export const datasets = {
  exampleEvents,
};
`;
}

