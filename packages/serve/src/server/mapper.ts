import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  ServeEndpoint,
  ToolkitQueryDescription,
} from "../types.js";

export const mapEndpointToToolkit = (
  endpoint: ServeEndpoint<any, any, any, any>
): ToolkitQueryDescription => {
  // Use type assertion to avoid deep type instantiation issues with zodToJsonSchema
  const inputSchema: unknown = endpoint.inputSchema
    ? zodToJsonSchema(endpoint.inputSchema as any, { target: "openApi3" })
    : undefined;
  const outputSchema: unknown = endpoint.outputSchema
    ? zodToJsonSchema(endpoint.outputSchema as any, { target: "openApi3" })
    : undefined;

  return {
    key: endpoint.key,
    path: endpoint.metadata.path,
    method: endpoint.method,
    name: endpoint.metadata.name ?? endpoint.key,
    summary: endpoint.metadata.summary,
    description: endpoint.metadata.description,
    tags: endpoint.metadata.tags,
    visibility: endpoint.metadata.visibility,
    requiresAuth: Boolean(endpoint.metadata.requiresAuth),
    requiresTenant: endpoint.tenant ? (endpoint.tenant.required !== false) : undefined,
    inputSchema,
    outputSchema,
    custom: endpoint.metadata.custom,
  };
};
