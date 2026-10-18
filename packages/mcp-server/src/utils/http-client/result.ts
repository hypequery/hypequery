import type { ClientQueryPlan } from '@hypequery/protocol';
import { MCPExecutionBudgetError, MCPToolError } from '../../errors.js';

import { decodeHttpResultJson, HttpResultJsonBudgetError } from './json.js';
function invalid(): never {
  throw new MCPToolError('MCP_EXECUTION_FAILED', 'Backend returned an invalid client result.', { retryable: false });
}
function record(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  if (allowed && Object.keys(value).some(key => !allowed.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function string(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++index);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** Duplicate-aware bounded JSON, closed public metadata and exact requested row fields. */
export function clientHttpResult(text: string, plan: ClientQueryPlan): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = decodeHttpResultJson(text); } catch (error) {
    if (error instanceof HttpResultJsonBudgetError) throw new MCPExecutionBudgetError('MCP_RESULT_TOO_LARGE', 'Backend result exceeds JSON limits.');
    return invalid();
  }
  const result = record(parsed, ['data', 'meta']);
  if (!Array.isArray(result.data) || result.data.length > plan.effectiveLimit) return invalid();
  const dimensions = plan.body.dimensions as readonly string[];
  const fields = [...dimensions, ...plan.selectedMeasures, ...(plan.body.by === undefined ? [] : ['period'])];
  for (const item of result.data) {
    const row = record(item, fields);
    if (Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))) return invalid();
    for (const field of fields) {
      const value = row[field];
      if (typeof value === 'number' && !Number.isFinite(value)) return invalid();
      if (field === 'period' && plan.body.by !== undefined && value !== null
        && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/.test(value))) return invalid();
      const dimension = Object.hasOwn(plan.endpoint.dimensions, field) && dimensions.includes(field) ? plan.endpoint.dimensions[field] : undefined;
      if (value === null) {
        if (dimension?.nullable === false) return invalid();
      } else if (!dimension) {
        if (!string(value)) return invalid();
      } else if (dimension.wireType === 'number-or-string') {
        if (!(string(value) || typeof value === 'number' && Number.isFinite(value))) return invalid();
      } else if (dimension.wireType === 'string') {
        if (!string(value)) return invalid();
      } else if (typeof value !== dimension.wireType) return invalid();
    }
  }
  if (result.meta !== undefined && result.meta !== null) {
    if (!plan.endpoint.metadata) return invalid();
    const meta = record(result.meta, ['requestId', 'timingMs', 'rowCount', 'pagination', 'cache']);
    if (!string(meta.requestId) || meta.requestId.length === 0 || meta.requestId.length > 1024
      || typeof meta.timingMs !== 'number' || meta.timingMs < 0 || !Number.isFinite(meta.timingMs)
      || meta.rowCount !== result.data.length) return invalid();
    const pagination = record(meta.pagination, ['limit', 'offset', 'hasMore']);
    if (!integer(pagination.limit, 1) || pagination.limit > plan.effectiveLimit
      || pagination.offset !== plan.body.offset || typeof pagination.hasMore !== 'boolean'
      || result.data.length > pagination.limit || pagination.hasMore && result.data.length !== pagination.limit) return invalid();
    if (meta.cache !== undefined && typeof record(meta.cache, ['hit']).hit !== 'boolean') return invalid();
  } else if (plan.body.includeMeta === true) return invalid();
  return result;
}
