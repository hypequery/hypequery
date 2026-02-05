import { zodToJsonSchema } from "zod-to-json-schema";
export const mapEndpointToToolkit = (endpoint) => {
    // Type assertions (as any) are necessary below for external library compatibility:
    // - zod-to-json-schema doesn't export types that properly constrain Zod schema inputs
    // - Using 'unknown' for the result type is safer than 'any' for the output
    // - This is a known limitation of the zod-to-json-schema library
    const inputSchema = endpoint.inputSchema
        ? zodToJsonSchema(endpoint.inputSchema, { target: "openApi3" })
        : undefined;
    const outputSchema = endpoint.outputSchema
        ? zodToJsonSchema(endpoint.outputSchema, { target: "openApi3" })
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
