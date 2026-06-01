import type {
  AnyDatasetInstance,
  ExecutionContext,
} from "./types.js";

type DatasetShape = AnyDatasetInstance;

export function resolveDimensionExpression(
  ds: DatasetShape,
  dimensionName: string,
): string {
  const definition = ds.dimensions[dimensionName];
  return definition?.sql ?? definition?.column ?? dimensionName;
}

export function resolveFilterField(
  ds: DatasetShape,
  filterField: string,
): string {
  const resolvedField = ds.filters[filterField]?.field ?? filterField;
  return resolveDimensionExpression(ds, resolvedField);
}

export function resolveTenantFilterColumn(
  ds: DatasetShape,
  context?: ExecutionContext,
): string | undefined {
  if (!context?.runtime?.tenant?.id) {
    return undefined;
  }

  return context.runtime.tenant.column ?? ds.tenantKey;
}
