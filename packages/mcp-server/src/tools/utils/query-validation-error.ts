import { MCPToolError } from '../../errors.js';

/**
 * `@hypequery/datasets` refuses a query it cannot plan by failing validation
 * before any SQL runs: a plain `Error` whose message is `Invalid dataset
 * query: …` or `Invalid metric query: …`, followed by its reasons. Both
 * prefixes are required, so a driver error never matches.
 */
const VALIDATION_REFUSAL = /^Invalid (?:dataset|metric) query: (.+)$/s;

/**
 * The tool error for a query the dataset client refused as invalid.
 *
 * Some rules are the planner's alone: a `fill` or a time calculation needs a
 * bounded time range, a trailing window must span whole grain periods, a
 * calculation input must be a measure the query selects. Without this the
 * agent reads `MCP_EXECUTION_FAILED`, `retryable: true`, and retries a call
 * that can never succeed. It is `MCP_INVALID_ARGUMENTS` with the client's own
 * reasons, the same text Serve returns in a 400, so it can correct the call
 * in one round trip.
 *
 * Returns `undefined` for anything else, so the caller rethrows it unchanged.
 */
export function queryValidationError(error: unknown, tool: string): MCPToolError | undefined {
  if (!(error instanceof Error) || error instanceof MCPToolError) return undefined;
  const match = VALIDATION_REFUSAL.exec(error.message);
  if (!match) return undefined;
  return new MCPToolError('MCP_INVALID_ARGUMENTS', `Invalid ${tool} arguments: ${match[1]}`, {
    retryable: false,
    correctable: true,
  });
}
