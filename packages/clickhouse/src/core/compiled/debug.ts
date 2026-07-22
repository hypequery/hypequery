import type {
  CompiledDebugForm,
  CompiledParameterDeclaration,
  CompiledSettings,
} from './types.js';
import { replaceParameterPlaceholders } from './parameters.js';

/**
 * Marker wrapping placeholders in the debug form. The guillemets make the rendered SQL
 * deliberately invalid as database SQL — it cannot be pasted into a client and run — while
 * still showing structure and declared types (RFC 0010 §Debug form).
 */
const DEBUG_OPEN = '«param ';
const DEBUG_CLOSE = '»';

/**
 * Build the redacted, non-executable debug form. It carries no parameter values, tenant
 * values, credentials, or setting values — only names, declared types, and structure.
 */
export function buildDebugForm(
  sql: string,
  parameters: readonly CompiledParameterDeclaration[],
  settings: CompiledSettings
): CompiledDebugForm {
  const redactedSql = replaceParameterPlaceholders(
    sql,
    (name, type) => `${DEBUG_OPEN}${name}: ${type}${DEBUG_CLOSE}`,
  );

  return Object.freeze({
    sql: redactedSql,
    parameters: Object.freeze(parameters.map((p) => Object.freeze({
      name: p.name as string,
      type: p.type.clickHouseType,
      optional: p.optional,
    }))),
    // Setting names only; values are policy and never appear in diagnostics.
    settings: Object.freeze(Object.keys(settings).filter(
      (key) => settings[key as keyof CompiledSettings] !== undefined
    )),
  });
}
