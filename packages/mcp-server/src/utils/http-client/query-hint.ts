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

/** The names a field pointer (`/dimensions/0`, `/filters/1/field`, ...) may take on `endpoint`. */
export function clientQueryFieldHint(endpoint: ProtocolClientEndpoint, path: string): string {
  const names = fieldNames(endpoint, path);
  if (names === undefined) return '';
  return names.length === 0
    ? ` ${quote(endpoint.id)} offers none.`
    : offered(`Offered by ${quote(endpoint.id)}`, names.map(quote));
}

function fieldNames(endpoint: ProtocolClientEndpoint, path: string): string[] | undefined {
  const [, member, , leaf] = /^\/(dimensions|measures|filters|orderBy|having)\/\d+(\/(field))?$/.exec(path) ?? [];
  if (member === 'dimensions' && leaf === undefined) {
    return Object.entries(endpoint.dimensions).filter(([, field]) => field.groupable).map(([name]) => name);
  }
  if (member === 'measures' && leaf === undefined) return Object.keys(endpoint.measures);
  if (member === 'filters' && leaf === 'field') return Object.keys(endpoint.filters);
  if (member === 'having' && leaf === 'field') return Object.keys(endpoint.measures);
  if (member === 'orderBy' && leaf === 'field') {
    return [
      ...Object.entries(endpoint.dimensions).filter(([, field]) => field.orderable).map(([name]) => name),
      ...Object.keys(endpoint.measures),
    ];
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
