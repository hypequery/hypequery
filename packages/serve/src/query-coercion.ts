import { isZod4Schema } from "@hypequery/datasets/internal";
import type { ServeSchema } from "./types.js";

/**
 * Query strings carry no types — every value arrives as a string, or an array of
 * strings when a key repeats. A schema field declared `z.number()` therefore
 * always failed validation with `expected number, received string`, which made
 * GET endpoints unusable for any input that was not itself a string.
 *
 * This coerces query values toward what the schema declares, before validation.
 * It is deliberately conservative: anything it cannot confidently convert is
 * passed through untouched so zod still produces the real error message rather
 * than a misleading one about a value this module invented.
 *
 * Only applied to query-sourced input. JSON bodies already carry types and are
 * left alone.
 */

type ZodDefLike = { typeName?: string; [key: string]: unknown };

/** Zod 4 definition types, named as the Zod 3 types this module switches on. */
const ZOD4_TYPE_NAMES: Record<string, string> = {
  optional: "ZodOptional",
  nonoptional: "ZodOptional",
  nullable: "ZodNullable",
  default: "ZodDefault",
  prefault: "ZodDefault",
  catch: "ZodCatch",
  readonly: "ZodReadonly",
  pipe: "ZodPipeline",
  number: "ZodNumber",
  bigint: "ZodBigInt",
  boolean: "ZodBoolean",
  date: "ZodDate",
  array: "ZodArray",
  object: "ZodObject",
  never: "ZodNever",
};

/**
 * A schema's definition in Zod 3 form. Zod 4 keeps refinements on the schema
 * itself and expresses preprocess as a pipe out of a transform, so that pipe
 * is reported as a preprocess effect and stays wrapped.
 */
const defOf = (schema: unknown): ZodDefLike | undefined => {
  if (!isZod4Schema(schema)) return (schema as { _def?: ZodDefLike } | undefined)?._def;
  const def = schema._zod.def;
  if (def.type === "pipe" && isZod4Schema(def.in) && def.in._zod.def.type === "transform") {
    return { typeName: "ZodEffects", effect: { type: "preprocess" } };
  }
  return { ...def, typeName: ZOD4_TYPE_NAMES[def.type] ?? def.type, type: def.element };
};

const typeNameOf = (schema: unknown): string | undefined => defOf(schema)?.typeName;

/**
 * Strips wrappers that do not change what a query value should be coerced to.
 * `ZodPipeline` unwraps to its input side, since that is what validation
 * receives. Preprocess effects stay wrapped so their callback sees the raw wire
 * value as declared by the schema.
 */
function unwrap(schema: unknown, depth = 0): unknown {
  if (!schema || depth > 10) return schema;

  const def = defOf(schema);
  switch (def?.typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodCatch":
    case "ZodReadonly":
      return unwrap(def.innerType, depth + 1);
    case "ZodBranded":
      return unwrap(def.type, depth + 1);
    case "ZodEffects": {
      const effect = def.effect as { type?: unknown } | undefined;
      if (effect?.type === "preprocess") return schema;
      return unwrap(def.schema, depth + 1);
    }
    case "ZodPipeline":
      return unwrap(def.in, depth + 1);
    default:
      return schema;
  }
}

function coerceScalar(target: unknown, value: string): unknown {
  switch (typeNameOf(target)) {
    case "ZodNumber": {
      if (value.trim() === "") return value;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
    case "ZodBigInt": {
      if (value.trim() === "") return value;
      try {
        return BigInt(value);
      } catch {
        return value;
      }
    }
    case "ZodBoolean": {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") return true;
      if (normalized === "false" || normalized === "0") return false;
      return value;
    }
    case "ZodDate": {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : parsed;
    }
    default:
      // Strings, enums, literals, unions, and anything unrecognised are already
      // in their wire form or too ambiguous to guess at.
      return value;
  }
}

function coerceValue(target: unknown, value: unknown): unknown {
  const unwrapped = unwrap(target);

  if (typeNameOf(unwrapped) === "ZodArray") {
    const element = (defOf(unwrapped)?.type ?? undefined) as ServeSchema | undefined;
    // A key that appears once arrives as a scalar, but the schema wants a list.
    const items = Array.isArray(value) ? value : [value];
    return items.map((item) => coerceValue(element, item));
  }

  // A repeated key produced an array the schema does not want. Leave it so zod
  // reports the real mismatch.
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value;

  return coerceScalar(unwrapped, value);
}

/**
 * Returns a copy of `raw` with values coerced toward `schema`. Returns `raw`
 * untouched when the schema is absent, is not an object schema, or when the
 * payload is not a plain object.
 */
export function coerceQueryInput(schema: ServeSchema | undefined, raw: unknown): unknown {
  if (!schema || raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }

  try {
    const objectSchema = unwrap(schema);
    if (typeNameOf(objectSchema) !== "ZodObject") return raw;

    const objectDef = defOf(objectSchema);
    const shapeFactory = objectDef?.shape;
    const shape = (typeof shapeFactory === "function" ? shapeFactory() : shapeFactory) as
      | Record<string, ServeSchema>
      | undefined;
    if (!shape) return raw;
    const catchall = typeNameOf(objectDef?.catchall) === "ZodNever"
      ? undefined
      : objectDef?.catchall as ServeSchema | undefined;

    const coerced: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    for (const [key, value] of Object.entries(coerced)) {
      const target = Object.prototype.hasOwnProperty.call(shape, key)
        ? shape[key]
        : catchall;
      // Untyped unknown keys are left for the schema to strip or reject.
      if (!target) continue;
      coerced[key] = coerceValue(target, value);
    }
    return coerced;
  } catch {
    // Coercion is a convenience, never a failure mode. Fall back to the raw
    // payload so validation reports the genuine problem.
    return raw;
  }
}
