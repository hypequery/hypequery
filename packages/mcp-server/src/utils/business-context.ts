import {
  isEmptyProtocolBusinessContext,
  validateProtocolBusinessContext,
  type ProtocolBusinessContext,
} from '@hypequery/protocol';

/** Business context as an agent reads it: the document without its `kind`/`version` header. */
export type MCPBusinessContext = Omit<ProtocolBusinessContext, 'kind' | 'version'>;

/**
 * The largest business context `list_datasets` carries in full, in UTF-8 bytes
 * of its JSON. Above it, `list_datasets` carries the summary only and points at
 * `get_business_context`, so a large glossary can never push the catalog the
 * agent reads first over its result budget.
 */
export const LIST_DATASETS_CONTEXT_INLINE_BYTES = 32 * 1024;

const encoder = new TextEncoder();

/**
 * Validate the configured document and drop its header. An empty document is
 * the same as none, so it adds no tool and changes no listing.
 */
export function resolveMCPBusinessContext(
  input: ProtocolBusinessContext | undefined,
): MCPBusinessContext | undefined {
  if (input === undefined) return undefined;
  const document = validateProtocolBusinessContext(input);
  if (isEmptyProtocolBusinessContext(document)) return undefined;
  const { kind: _kind, version: _version, ...context } = document;
  return context;
}

/** The context `list_datasets` returns: all of it when small, else the summary and a pointer. */
export function listDatasetsBusinessContext(context: MCPBusinessContext): Record<string, unknown> {
  if (encoder.encode(JSON.stringify(context)).byteLength <= LIST_DATASETS_CONTEXT_INLINE_BYTES) {
    return { ...context };
  }
  return {
    ...(context.summary === undefined ? {} : { summary: context.summary }),
    truncated: true,
    hint: 'This business context is too large to list here. Call get_business_context for the KPIs, glossary, conventions and caveats.',
  };
}

function section(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : [`## ${title}`, ...lines, ''];
}

/**
 * Business context as Markdown, for an agent's system prompt or instructions.
 * The same text for the same document, in the document's own order.
 */
export function formatBusinessContext(input: ProtocolBusinessContext | MCPBusinessContext): string {
  const context = 'kind' in input ? resolveMCPBusinessContext(input) ?? {} : input;
  const about = [
    context.summary,
    context.industry === undefined ? undefined : `Industry: ${context.industry}`,
    context.businessModel === undefined ? undefined : `Business model: ${context.businessModel}`,
    context.customers === undefined ? undefined : `Customers: ${context.customers}`,
    context.audience === undefined ? undefined : `Audience: ${context.audience}`,
  ].filter((line): line is string => line !== undefined);
  const lines = [
    '# Business context',
    '',
    ...section('About the business', about),
    ...section('Goals', (context.goals ?? []).map(goal => `- ${goal}`)),
    ...section('KPIs', (context.kpis ?? []).map(kpi => `- **${kpi.name}**: ${kpi.definition}`)),
    ...section('Glossary', (context.glossary ?? []).map(term => `- **${term.term}**: ${term.meaning}`)),
    ...section('Reporting conventions', context.conventions === undefined ? [] : [context.conventions]),
    ...section('Data caveats', (context.caveats ?? []).map(caveat => `- ${caveat}`)),
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}
