/**
 * Get Business Context Tool
 *
 * Returns the project's reviewed business context: what the business does,
 * its KPIs and their definitions, its glossary, reporting conventions and
 * known data caveats. Listed only when the server is configured with one.
 */

import type { MCPToolResponse } from '../types.js';
import type { MCPBusinessContext } from '../utils/business-context.js';
import { createMCPToolResponse } from './utils/tool-response.js';

export async function getBusinessContextTool(businessContext: MCPBusinessContext): Promise<MCPToolResponse> {
  return createMCPToolResponse({ businessContext: { ...businessContext } });
}
