import { MCPToolError } from '../../errors.js';

/** `reason` on the error an agent receives for a filter on the tenant field. */
export const TENANT_FIELD_NOT_FILTERABLE = 'MCP_TENANT_FIELD_NOT_FILTERABLE';

/**
 * `@hypequery/datasets` refuses an explicit filter on a dataset's tenant field
 * while a runtime tenant is applied, by failing validation: a plain `Error`
 * whose message is `Invalid dataset query: …` or `Invalid metric query: …` and
 * names the field. Both prefixes are required, so only a validation failure
 * matches, never a driver error that happens to quote the same words.
 */
const TENANT_FILTER_REFUSAL = /^Invalid (?:dataset|metric) query: (?:.*; )?Cannot filter on tenant field "([^"]+)"/s;

/**
 * The tool error for a tenant-scoped caller that filtered on the tenant field.
 *
 * Without this the refusal reaches the agent as an unclassified failure:
 * `MCP_EXECUTION_FAILED`, `retryable: true`, which invites a retry that can
 * never succeed. The caller sent a correctable argument, so it is
 * `MCP_INVALID_ARGUMENTS`, not retryable, with nothing to relist.
 *
 * Returns `undefined` for anything else, so the caller rethrows it unchanged.
 */
export function tenantFieldFilterError(
  error: unknown,
  tenantId: string | undefined,
): MCPToolError | undefined {
  if (!tenantId || !(error instanceof Error) || error instanceof MCPToolError) return undefined;
  const match = TENANT_FILTER_REFUSAL.exec(error.message);
  if (!match) return undefined;
  const field = match[1];
  return new MCPToolError(
    'MCP_INVALID_ARGUMENTS',
    `Cannot filter on tenant field "${field}": this caller's tenant is fixed by its credential.`,
    {
      retryable: false,
      correctable: true,
      relist: false,
      reason: TENANT_FIELD_NOT_FILTERABLE,
      hint: `Remove the filter on "${field}" and run the query again. Your tenant is fixed by your credential and every query is already scoped to it; no filter or argument can change it.`,
    },
  );
}
