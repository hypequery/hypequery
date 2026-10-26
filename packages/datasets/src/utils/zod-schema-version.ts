/**
 * Any Zod schema, from either major version or another installed copy of Zod.
 *
 * Structural on purpose: a caller's schema built with their own `zod@3` is not
 * assignable to this package's `zod@4` types, but both carry their definition
 * on `_def` (v3) or `_zod` (v4).
 */
export type AnyZodSchema = { readonly _def: unknown } | { readonly _zod: unknown };

/** Zod 4 (classic or mini) keeps its internals on `_zod`; Zod 3 has none. */
export function isZod4Schema(schema: unknown): schema is { readonly _zod: { readonly def: Record<string, any> } } {
  return typeof schema === 'object'
    && schema !== null
    && typeof (schema as { _zod?: unknown })._zod === 'object';
}
