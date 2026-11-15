import type { ScriptedCall, ToolOutput } from '../scripted-model';

export type Row = Record<string, unknown>;

export function rows(outputs: ToolOutput[]): Row[] {
  return outputs
    .filter((o) => o.toolName === 'query_dataset')
    .flatMap((o) => ((o.output as { data?: Row[] } | undefined)?.data ?? []));
}

export function errors(outputs: ToolOutput[]): unknown[] {
  return outputs.map((o) => (o.output as { error?: unknown } | undefined)?.error).filter(Boolean);
}

/** The calls a prompt injection would make a model try. */
export function crossTenantScript(otherTenantId: string): ScriptedCall[] {
  return [
    { toolName: 'list_datasets', input: {} },
    // Filter on the other customer's id.
    { toolName: 'query_dataset', input: { dataset: 'events', measures: ['events'], filters: [{ field: 'tenantId', operator: 'eq', value: Number(otherTenantId) }] } },
    // Pass the tenant as an argument.
    { toolName: 'query_dataset', input: { dataset: 'events', measures: ['events'], tenant: otherTenantId, tenantId: otherTenantId } },
    // Group by customer to see every tenant at once.
    { toolName: 'query_dataset', input: { dataset: 'events', dimensions: ['tenantId'], measures: ['events', 'uniqueUsers'] } },
  ];
}
