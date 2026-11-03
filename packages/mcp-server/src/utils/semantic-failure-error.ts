import type {
  ProtocolSemanticInvocationFailure,
  ProtocolSemanticInvocationFailureCategory,
} from '@hypequery/protocol';
import { MCPToolError, type MCPToolErrorCode } from '../errors.js';

/**
 * The MCP code for each semantic data-plane failure category.
 *
 * Exhaustive by construction, so a new protocol category fails the build here
 * rather than reaching an agent as a generic failure.
 */
const CODE_BY_CATEGORY: Record<ProtocolSemanticInvocationFailureCategory, MCPToolErrorCode> = {
  'input-invalid': 'MCP_INVALID_ARGUMENTS',
  'not-found': 'MCP_NOT_FOUND',
  unauthenticated: 'MCP_UNAUTHORIZED',
  forbidden: 'MCP_UNAUTHORIZED',
  'tenant-required': 'MCP_UNAUTHORIZED',
  'stale-activation': 'MCP_STALE_CONTRACT',
  // The data plane cancels a query that runs past its deadline.
  cancelled: 'MCP_QUERY_TIMEOUT',
  'budget-exceeded': 'MCP_RESULT_TOO_LARGE',
  'configuration-invalid': 'MCP_EXECUTION_FAILED',
  'unsupported-capability': 'MCP_EXECUTION_FAILED',
  'executor-unavailable': 'MCP_EXECUTION_FAILED',
  'executor-failed': 'MCP_EXECUTION_FAILED',
  'output-invalid': 'MCP_EXECUTION_FAILED',
};

/**
 * A hosted gateway's `query_dataset` failure as the MCP tool error an agent
 * receives.
 *
 * A gateway that executes through a semantic data plane gets a closed
 * protocol failure back; an MCP SDK client accepts only an error that matches
 * the tool's published envelope. This is the one mapping between them, so
 * every hosted MCP states the same failure the same way. The failure's own
 * `code` travels as `reason`, its `relist` as `relist`, and its message is
 * already safe to show (protocol failures are closed by construction).
 */
export function mcpToolErrorFromSemanticFailure(
  failure: Pick<
    ProtocolSemanticInvocationFailure,
    'category' | 'code' | 'message' | 'retryable' | 'relist'
  >,
  options: { retryAfterSeconds?: number } = {},
): MCPToolError {
  return new MCPToolError(CODE_BY_CATEGORY[failure.category] ?? 'MCP_EXECUTION_FAILED', failure.message, {
    retryable: failure.retryable,
    correctable: failure.category === 'input-invalid' || failure.category === 'not-found',
    relist: failure.relist,
    reason: failure.code,
    ...(options.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: options.retryAfterSeconds }),
  });
}
