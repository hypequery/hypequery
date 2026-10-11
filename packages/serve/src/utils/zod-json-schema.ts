import { z, type ZodTypeAny } from "zod";

/**
 * Converts a Zod schema into an inline OpenAPI 3.0 schema object.
 *
 * - `io` picks which side to describe. Request schemas use `"input"` (a field
 *   with `.default()` is optional, matching what a caller sends); response
 *   schemas use `"output"` (what the handler actually returns).
 * - Inlines shared sub-schemas instead of emitting `$ref`s.
 * - Keeps the wire formats clients already rely on for types JSON Schema has
 *   no native form for: dates as ISO `date-time` strings, bigints as `int64`
 *   integers. Anything else unrepresentable becomes `{}` instead of throwing.
 */
export const zodToOpenApiSchema = (
  schema: ZodTypeAny,
  io: "input" | "output",
): Record<string, unknown> =>
  z.toJSONSchema(schema, {
    target: "openapi-3.0",
    io,
    reused: "inline",
    unrepresentable: "any",
    override: ({ zodSchema, jsonSchema }) => {
      switch (zodSchema._zod.def.type) {
        case "date":
          jsonSchema.type = "string";
          jsonSchema.format = "date-time";
          break;
        case "bigint":
          jsonSchema.type = "integer";
          jsonSchema.format = "int64";
          break;
      }
    },
  }) as Record<string, unknown>;
