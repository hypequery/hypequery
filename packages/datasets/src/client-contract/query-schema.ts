import {
  validateProtocolClientContract, validateProtocolClientQuery,
  type ProtocolClientContract, type ProtocolClientEndpoint,
} from '@hypequery/protocol';
import { z, type ZodTypeAny } from 'zod';
import { toSemanticJsonSchema, type CanonicalSemanticQuerySchemas } from '../semantic-query-schema.js';
import type { JsonSchema } from '../tools.js';

export interface ClientEndpointQuerySchema {
  readonly endpoint: ProtocolClientEndpoint;
  readonly http: ZodTypeAny;
  readonly httpJsonSchema: JsonSchema;
}
export interface ClientContractQuerySchemas extends CanonicalSemanticQuerySchemas {
  readonly contract: ProtocolClientContract;
  readonly endpoints: ReadonlyMap<string, ClientEndpointQuerySchema>;
}
function union(schemas: ZodTypeAny[]): ZodTypeAny {
  return schemas.length === 0 ? z.never() : schemas.length === 1 ? schemas[0]
    : z.union(schemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}
function enumeration(values: readonly string[]): ZodTypeAny {
  return values.length ? z.enum(values as [string, ...string[]]) : z.never();
}
function predicates(endpoint: ProtocolClientEndpoint, having: boolean): ZodTypeAny {
  const definitions = having ? Object.entries(endpoint.measures).filter(([, m]) => m.having)
    .map(([key]) => [key, { type: 'number', operators: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between'] }] as const)
    : Object.entries(endpoint.filters);
  return union(definitions.flatMap(([key, field]) => field.operators.map(operator => {
    const scalar = field.type === 'number' ? z.number().finite()
      : field.type === 'boolean' ? z.boolean() : z.string();
    const value = operator === 'between' ? z.tuple([scalar, scalar])
      : operator === 'in' || operator === 'notIn' ? z.array(scalar).min(1).max(endpoint.limits.maxFilterValues)
        : scalar;
    return z.object({ [having ? 'measure' : 'field']: z.literal(key), operator: z.literal(operator), value }).strict();
  })));
}
function endpointSchema(contract: ProtocolClientContract, endpoint: ProtocolClientEndpoint,
  transport: 'http' | 'mcp'): ZodTypeAny {
  const caps = endpoint.limits;
  const groupable = Object.keys(endpoint.dimensions).filter(key => endpoint.dimensions[key].groupable);
  const orderable = [...Object.keys(endpoint.dimensions).filter(key => endpoint.dimensions[key].groupable && endpoint.dimensions[key].orderable),
    ...Object.keys(endpoint.measures), ...(endpoint.time ? ['period'] : [])];
  const fields: Record<string, ZodTypeAny> = {
    dimensions: z.array(enumeration(groupable)).max(caps.maxDimensions).optional(),
    filters: z.array(predicates(endpoint, false)).max(caps.maxPredicates).optional(),
    orderBy: z.array(z.object({ field: enumeration(orderable), direction: z.enum(['asc', 'desc']) }).strict()).max(caps.maxOrderBy).optional(),
    limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    offset: z.number().int().min(0).max(caps.maxOffset).optional(),
    includeMeta: (endpoint.metadata ? z.boolean() : z.literal(false)).optional(),
  };
  if (endpoint.kind === 'dataset') {
    fields.measures = z.array(enumeration(Object.keys(endpoint.measures))).max(caps.maxMeasures).optional();
    fields.having = z.array(predicates(endpoint, true)).max(caps.maxPredicates).optional();
  }
  if (endpoint.time) {
    fields[transport === 'http' ? 'by' : 'grain'] = enumeration(endpoint.time.grains).optional();
    if (endpoint.time.timezone) fields.timezone = z.string().optional();
  }
  if (transport === 'mcp') {
    fields.dataset = z.literal(endpoint.dataset);
    if (endpoint.kind === 'metric') fields.metric = z.literal(endpoint.id);
  }
  return z.object(fields).strict().superRefine((input, context) => {
    try { validateProtocolClientQuery(contract, endpoint.id, input, transport); }
    catch { context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid client query.' }); }
  });
}
/** Compile typed endpoint and MCP schemas from the same validated client descriptor.
 * JSON Schema describes structural constraints; execution must retain the runtime
 * validator for selected-field dependencies, uniqueness, and combined budgets.
 */
export function buildClientContractQuerySchemas(input: unknown): ClientContractQuerySchemas {
  const contract = validateProtocolClientContract(input);
  const endpoints = new Map<string, ClientEndpointQuerySchema>();
  const datasets: ZodTypeAny[] = [], metrics: ZodTypeAny[] = [];
  for (const endpoint of contract.endpoints) {
    const http = endpointSchema(contract, endpoint, 'http');
    endpoints.set(endpoint.id, { endpoint, http, httpJsonSchema: toSemanticJsonSchema(http) });
    (endpoint.kind === 'dataset' ? datasets : metrics).push(endpointSchema(contract, endpoint, 'mcp'));
  }
  // Preserve the existing fixed MCP tool names while making empty views uncallable.
  const queryDataset = datasets.length ? union(datasets) : z.object({ dataset: z.never() }).strict();
  const queryMetric = metrics.length ? union(metrics) : z.object({ dataset: z.never(), metric: z.never() }).strict();
  return { contract, endpoints, queryDataset, queryMetric,
    queryDatasetJsonSchema: toSemanticJsonSchema(queryDataset),
    queryMetricJsonSchema: toSemanticJsonSchema(queryMetric), manifestHash: contract.contentHash };
}
