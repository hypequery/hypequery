import { prepareProtocolClientContract, type ProtocolClientContract } from '@hypequery/protocol';
import type { MCPQueryLimits } from '../../types.js';
import { resolveQueryLimits } from '../../tools/utils/query-limits.js';
import { MCPToolError } from '../../errors.js';

/** Lower operational limits only; the backend's endpoint schema hashes stay identical. */
export function mcpClientProfile(contract: ProtocolClientContract, configured?: MCPQueryLimits): ProtocolClientContract {
  const limits = resolveQueryLimits(undefined, configured);
  try {
    return prepareProtocolClientContract({
      kind: contract.kind, version: contract.version, view: contract.view,
      endpoints: contract.endpoints.map(({ schemaHash: _hash, ...endpoint }) => ({
        ...endpoint,
        limits: {
          ...endpoint.limits,
          maxLimit: Math.min(endpoint.limits.maxLimit, limits.maxResultSize, 1000),
          defaultLimit: Math.min(endpoint.limits.defaultLimit, limits.defaultResultSize, limits.maxResultSize, 1000),
          maxOffset: Math.min(endpoint.limits.maxOffset, limits.maxOffset),
          maxDimensions: Math.min(endpoint.limits.maxDimensions, limits.maxDimensions),
          maxMeasures: Math.min(endpoint.limits.maxMeasures, limits.maxMeasures),
          maxPredicates: Math.min(endpoint.limits.maxPredicates, limits.maxFilters),
          maxOrderBy: Math.min(endpoint.limits.maxOrderBy, limits.maxOrderBy),
          maxFilterValues: Math.min(endpoint.limits.maxFilterValues, 1000),
        },
      })),
    }).contract;
  } catch {
    throw new MCPToolError('MCP_CATALOG_TOO_LARGE', 'Client defaults exceed MCP query ceilings; publish a narrower profile.', { retryable: false });
  }
}
