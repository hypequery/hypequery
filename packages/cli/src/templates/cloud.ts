/** Generate the explicit Cloud publication entrypoint for dataset projects. */
export function generateCloudTemplate(): string {
  return `import { publishToCloud } from '@hypequery/datasets';
import { datasets } from './datasets.js';

export const cloud = publishToCloud({
  datasets,
  access: { roles: [], scopes: [] },
});
`;
}
