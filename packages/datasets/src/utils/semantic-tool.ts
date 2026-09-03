import type { ZodTypeAny } from 'zod';

export function semanticToolNamePart(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_-]/g, '_');
  return /^[A-Za-z_]/.test(normalized) ? normalized : `_${normalized}`;
}

export function parseCanonicalToolInput(
  schema: ZodTypeAny,
  input: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'input';
      return `${path}: ${issue.message}`;
    }).join('; ');
    throw new Error(`Invalid ${label}: ${issues}`);
  }
  return result.data;
}

export function redactSemanticToolSql(result: unknown, includeSql: boolean): unknown {
  if (includeSql || !result || typeof result !== 'object') {
    return result;
  }

  const resultObject = result as { meta?: Record<string, unknown> };
  if (!resultObject.meta || typeof resultObject.meta !== 'object' || !('sql' in resultObject.meta)) {
    return result;
  }

  const { sql: _sql, ...meta } = resultObject.meta;
  return {
    ...resultObject,
    meta,
  };
}
