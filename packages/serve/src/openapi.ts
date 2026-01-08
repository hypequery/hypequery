import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { OpenApiDocument, OpenApiOptions, ServeEndpoint } from "./types";

const ERROR_SCHEMA = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        type: { type: "string" },
        message: { type: "string" },
        details: { type: "object" },
      },
      required: ["type", "message"],
    },
  },
  required: ["error"],
};

const dereferenceSchema = (schema: any) => {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  if (schema.$ref && schema.definitions) {
    const refKey = String(schema.$ref).split("/").pop();
    if (refKey && schema.definitions[refKey]) {
      return schema.definitions[refKey];
    }
  }

  return schema;
};

const toJsonSchema = (schema: ZodTypeAny | undefined, name: string) => {
  if (!schema) {
    return { type: "object" };
  }

  return zodToJsonSchema(schema as any, {
    target: "openApi3",
    name,
    $refStrategy: "none",
  }) as Record<string, unknown>;
};

const toQueryParameters = (schema: ZodTypeAny | undefined, name: string) => {
  if (!schema) {
    return [] as Array<Record<string, unknown>>;
  }

  const jsonSchema = dereferenceSchema(toJsonSchema(schema, name));

  if (!jsonSchema || typeof jsonSchema !== "object") {
    return [];
  }

  const schemaType = (jsonSchema as any).type;
  const isObjectType =
    schemaType === "object" || (Array.isArray(schemaType) && schemaType.includes("object"));

  if (!isObjectType || typeof (jsonSchema as any).properties !== "object") {
    return [];
  }

  const properties = (jsonSchema as any).properties as Record<string, unknown>;
  const requiredSet = new Set<string>(Array.isArray((jsonSchema as any).required) ? (jsonSchema as any).required : []);

  return Object.entries(properties).map(([key, value]) => ({
    name: key,
    in: "query",
    required: requiredSet.has(key),
    schema: value,
  }));
};

const toOperation = (endpoint: ServeEndpoint, nameSuffix: string) => {
  const operation: Record<string, unknown> = {
    operationId: endpoint.key,
    summary: endpoint.metadata.summary,
    description: endpoint.metadata.description,
    tags: endpoint.metadata.tags.length ? endpoint.metadata.tags : undefined,
    responses: {
      200: {
        description: "Successful response",
        content: {
          "application/json": {
            schema: toJsonSchema(endpoint.outputSchema, `${endpoint.key}${nameSuffix}`),
          },
        },
      },
      default: {
        description: "Error response",
        content: {
          "application/json": {
            schema: ERROR_SCHEMA,
          },
        },
      },
    },
  };

  const queryParameters =
    endpoint.method === "GET"
      ? toQueryParameters(endpoint.inputSchema, `${endpoint.key}Query`)
      : [];

  if (queryParameters.length > 0) {
    operation.parameters = queryParameters;
  } else if (endpoint.inputSchema) {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: toJsonSchema(endpoint.inputSchema, `${endpoint.key}Request`),
        },
      },
    };
  }

  if (endpoint.metadata.requiresAuth) {
    operation.security = [{ ApiKeyAuth: [] }];
  }

  return operation;
};

const normalizeInfo = (options?: OpenApiOptions) => {
  const info = options?.info;
  return {
    title: info?.title ?? "HypeQuery Serve API",
    version: options?.version ?? "1.0.0",
    description: info?.description,
    termsOfService: info?.termsOfService,
    contact: info?.contact,
    license: info?.license,
  };
};

export const buildOpenApiDocument = (
  endpoints: ServeEndpoint[],
  options?: OpenApiOptions
): OpenApiDocument => {
  const document: OpenApiDocument = {
    openapi: "3.1.0",
    info: normalizeInfo(options),
    servers: options?.servers ?? [],
    paths: {},
  };

  let needsSecurityScheme = false;

  for (const endpoint of endpoints) {
    if (endpoint.metadata.visibility && endpoint.metadata.visibility !== "public") {
      continue;
    }

    const path = endpoint.metadata.path || "/";
    const method = endpoint.method.toLowerCase();
    const pathItem = (document.paths[path] ??= {});
    const operation = toOperation(endpoint, "Response");

    if (endpoint.metadata.requiresAuth) {
      needsSecurityScheme = true;
    }

    pathItem[method] = operation;
  }

  if (needsSecurityScheme) {
    document.components = {
      ...(document.components ?? {}),
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          name: "Authorization",
          in: "header",
        },
      },
    };
  }

  return document;
};
