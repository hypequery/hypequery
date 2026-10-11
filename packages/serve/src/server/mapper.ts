import type {
  ServeEndpoint,
  ToolkitQueryDescription,
} from "../types.js";
import { zodToOpenApiSchema } from "../utils/zod-json-schema.js";

export const mapEndpointToToolkit = (
  endpoint: ServeEndpoint<any, any, any, any>
): ToolkitQueryDescription => {
  const inputSchema: unknown = endpoint.inputSchema
    ? zodToOpenApiSchema(endpoint.inputSchema, "input")
    : undefined;
  const outputSchema: unknown = endpoint.outputSchema
    ? zodToOpenApiSchema(endpoint.outputSchema, "output")
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
    requiredRoles: endpoint.requiredRoles,
    requiredScopes: endpoint.requiredScopes,
    inputSchema,
    outputSchema,
    custom: endpoint.metadata.custom,
  };
};
