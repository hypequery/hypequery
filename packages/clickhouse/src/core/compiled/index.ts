/**
 * CompiledQuery v1 (RFC 0010) — the versioned execution-request contract for the
 * ClickHouse runtime, introduced beside the legacy positional path. See `./types.ts`.
 *
 * CH-01 provides the shape, validation, and redacted debug/error surfaces. Wiring the real
 * `@clickhouse/client` `{name:Type}` + `query_params` transport, capability negotiation,
 * and end-to-end cancellation is CH-02+ and does not touch the legacy adapter signature.
 */
export {
  COMPILED_QUERY_VERSION,
  type CompiledDeadline,
  type CompiledDebugForm,
  type CompiledIdentifiers,
  type CompiledOperation,
  type CompiledParameterBindings,
  type CompiledParameterDeclaration,
  type CompiledParameterType,
  type CompiledParameterValue,
  type CompiledQueryV1,
  type CompiledSensitivity,
  type CompiledSettings,
} from './types.js';

export { compileQueryV1, type CompileQueryInput } from './compile.js';

export {
  assertNoValuesInSql,
  buildParameterBindings,
  extractReferencedParameters,
  validateParameterReferences,
} from './parameters.js';

export {
  COMPILED_SETTING_BOUNDS,
  type CompiledSettingName,
  type DeadlineInputs,
  type SettingBound,
  resolveCompiledDeadline,
  resolveCompiledSettings,
} from './settings.js';

export {
  COMPILED_ERROR_CATEGORIES,
  CompiledQueryError,
  type CompiledErrorCategory,
  type CompiledErrorEnvelope,
  type CompiledQueryErrorOptions,
  isClientFaultCategory,
  isCompiledErrorCategory,
} from './errors.js';

export { buildDebugForm } from './debug.js';
