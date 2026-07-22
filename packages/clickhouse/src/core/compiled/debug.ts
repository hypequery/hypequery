import type {
  CompiledDebugForm,
  CompiledParameterDeclaration,
  CompiledSettings,
} from './types.js';

/**
 * Marker wrapping placeholders in the debug form. The guillemets make the rendered SQL
 * deliberately invalid as database SQL — it cannot be pasted into a client and run — while
 * still showing structure and declared types (RFC 0010 §Debug form).
 */
const DEBUG_OPEN = '«param ';
const DEBUG_CLOSE = '»';

const PLACEHOLDER_PATTERN = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^{}]+)\}/g;

/**
 * Build the redacted, non-executable debug form. It carries no parameter values, tenant
 * values, credentials, or setting values — only names, declared types, and structure.
 */
export function buildDebugForm(
  sql: string,
  parameters: readonly CompiledParameterDeclaration[],
  settings: CompiledSettings
): CompiledDebugForm {
  const redactedSql = sql.replace(
    PLACEHOLDER_PATTERN,
    (_match, name: string, type: string) =>
      `${DEBUG_OPEN}${name}: ${type.trim()}${DEBUG_CLOSE}`
  );

  return {
    sql: redactedSql,
    parameters: parameters.map((p) => ({
      name: p.name as string,
      type: p.type.clickHouseType,
      optional: p.optional,
    })),
    // Setting names only; values are policy and never appear in diagnostics.
    settings: Object.keys(settings).filter(
      (key) => settings[key as keyof CompiledSettings] !== undefined
    ),
  };
}
