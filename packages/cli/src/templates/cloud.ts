/** Generate the explicit Cloud publication entrypoint for dataset projects. */
export function generateCloudTemplate(): string {
  return `import { publishToCloud } from '@hypequery/datasets';
import { datasets } from './datasets.js';

export const cloud = publishToCloud({
  datasets,
  // Empty roles and scopes still require authentication, but let any
  // authenticated caller read every dataset. A dataset without tenantKey shows
  // every customer's rows; review both in Cloud under Customer access.
  access: { roles: [], scopes: [] },
});
`;
}
