import {
  type AuthTemplateMode,
  hostUserHelpers,
  contextAuthConfig,
} from './auth-scaffold.js';

export type { AuthTemplateMode };

/**
 * Generate api.ts file for the semantic datasets API.
 */
export function generateApiTemplate(options: { auth?: AuthTemplateMode } = {}): string {
  const authMode = options.auth ?? 'none';
  const serveImports = authMode === 'context' ? 'createAPI, fromContext' : 'createAPI';
  const authHelpers = authMode === 'context'
    ? `\n${hostUserHelpers}\n`
    : '';
  const authConfig = authMode === 'context'
    ? `${contextAuthConfig}\n`
    : '';

  return `import { ${serveImports} } from '@hypequery/serve';
import type { InferApiType } from '@hypequery/serve';
import { db } from './client.js';
import { datasets } from './datasets.js';
${authHelpers}
export const api = createAPI({
  queryBuilder: db,
  datasets,
${authConfig}});

export type ApiDefinition = InferApiType<typeof api>;
`;
}
