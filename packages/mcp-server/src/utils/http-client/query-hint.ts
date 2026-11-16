import type { ProtocolClientContract, ProtocolClientEndpoint } from '@hypequery/protocol';

/** At most this many names in one hint; a catalog can be large. */
const MAX_NAMES = 50;

/**
 * What a rejected client query could have used instead, as a sentence to append
 * to the error. It names only contract members (what the tool list already
 * offers this principal), never a submitted value. Python's `hypequery.mcp`
 * builds the same text.
 */
export function clientQueryTargetHint(contract: ProtocolClientContract, tool: string): string {
  if (tool === 'query_dataset') {
    return offered('Datasets', contract.endpoints.filter(e => e.kind === 'dataset').map(e => quote(e.id)));
  }
  return offered('Metrics', contract.endpoints.filter(e => e.kind === 'metric').map(e => `${quote(e.id)} on ${quote(e.dataset)}`));
}

/**
 * The names a field pointer may take on `endpoint`, matching the pointers the
 * validator emits: `/dimensions/N`, `/measures/N`, `/filters/N/field`,
 * `/having/N/measure` and `/orderBy/N/field`. `having` and `orderBy` accept
 * only what the query also selects, and the hint says so.
 */
export function clientQueryFieldHint(endpoint: ProtocolClientEndpoint, path: string): string {
  const hint = fieldHint(endpoint, path);
  if (hint === undefined) return '';
  return hint.names.length === 0
    ? ` ${quote(endpoint.id)} offers none.`
    : offered(hint.label, hint.names);
}

/** The hint's label and its names, already quoted. */
function fieldHint(endpoint: ProtocolClientEndpoint, path: string): { label: string; names: string[] } | undefined {
  const [, member, , leaf] = /^\/(dimensions|measures|filters|orderBy|having)\/\d+(\/(field|measure))?$/.exec(path) ?? [];
  const id = quote(endpoint.id);
  if (member === 'dimensions' && leaf === undefined) {
    return { label: `Offered by ${id}`, names: Object.entries(endpoint.dimensions).filter(([, field]) => field.groupable).map(([name]) => quote(name)) };
  }
  if (member === 'measures' && leaf === undefined) return { label: `Offered by ${id}`, names: Object.keys(endpoint.measures).map(quote) };
  if (member === 'filters' && leaf === 'field') return { label: `Offered by ${id}`, names: Object.keys(endpoint.filters).map(quote) };
  if (member === 'having' && leaf === 'measure') {
    return {
      label: `A selected measure ${id} allows in having`,
      names: Object.entries(endpoint.measures).filter(([, measure]) => measure.having).map(([name]) => quote(name)),
    };
  }
  if (member === 'orderBy' && leaf === 'field') {
    return {
      label: `A selected field ${id} can order by, once each`,
      names: [
        ...Object.entries(endpoint.dimensions).filter(([, field]) => field.groupable && field.orderable).map(([name]) => quote(name)),
        ...Object.keys(endpoint.measures).map(quote),
        ...(endpoint.time === null ? [] : [`${quote('period')} (with a grain)`]),
      ],
    };
  }
  return undefined;
}

function offered(label: string, names: string[]): string {
  if (names.length === 0) return '';
  const shown = names.slice(0, MAX_NAMES).join(', ');
  return ` ${label}: ${shown}${names.length > MAX_NAMES ? `, and ${names.length - MAX_NAMES} more` : ''}.`;
}

function quote(name: string): string {
  return JSON.stringify(name);
}
