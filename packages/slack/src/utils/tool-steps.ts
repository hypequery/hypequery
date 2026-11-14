/**
 * Build a `SlackAnswer` from an agent run's tool results. Typed structurally,
 * so it reads an AI SDK `generateText` result (`{ text, steps: [{ toolResults:
 * [{ toolName, input, output }] }] }`) from any AI SDK major without
 * depending on it.
 */

import { queryResultToTable, type SlackAnswer, type SlackAnswerSource } from '../blocks.js';

export interface ToolResultLike {
  toolName: string;
  input?: unknown;
  output?: unknown;
}

export interface AgentRunLike {
  text: string;
  steps?: ReadonlyArray<{ toolResults?: ReadonlyArray<ToolResultLike> }>;
  /** Some runners put results at the top level instead of per step. */
  toolResults?: ReadonlyArray<ToolResultLike>;
}

export interface AnswerFromToolResultsOptions {
  title?: string;
  link?: SlackAnswer['link'];
  /** Which tools return a result table. @default names starting with `query_` */
  isQueryTool?: (toolName: string) => boolean;
}

const OPERATOR_LABELS: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: 'in',
  notIn: 'not in',
  between: 'between',
  like: 'like',
  isNull: 'is empty',
  isNotNull: 'is not empty',
};

/**
 * The model's text, plus the table and source of the last successful query
 * the model ran. Numbers in the table come from the tool output, not from the
 * model's prose.
 */
export function answerFromToolResults(run: AgentRunLike, options: AnswerFromToolResultsOptions = {}): SlackAnswer {
  const isQueryTool = options.isQueryTool ?? ((name: string) => name.startsWith('query_'));
  const results = [...(run.steps ?? []).flatMap(step => step.toolResults ?? []), ...(run.toolResults ?? [])];

  for (let i = results.length - 1; i >= 0; i--) {
    const result = results[i]!;
    if (!isQueryTool(result.toolName)) continue;
    const table = queryResultToTable(result.output);
    if (!table) continue;
    return {
      title: options.title,
      text: run.text,
      table,
      source: sourceFromInput(result.input),
      link: options.link,
    };
  }
  return { title: options.title, text: run.text, link: options.link };
}

/** `dataset` and human-readable `filters` from a `query_dataset` / `query_metric` input. */
export function sourceFromInput(input: unknown): SlackAnswerSource | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const dataset = typeof record.dataset === 'string' ? record.dataset : typeof record.metric === 'string' ? record.metric : undefined;
  const filters = Array.isArray(record.filters) ? record.filters.map(formatFilter).filter((f): f is string => f !== null) : [];
  if (!dataset && filters.length === 0) return undefined;
  return { ...(dataset ? { dataset } : {}), ...(filters.length > 0 ? { filters } : {}) };
}

/** `{ field: 'region', operator: 'in', value: ['EU', 'US'] }` → `region in EU, US`. */
export function formatFilter(filter: unknown): string | null {
  if (typeof filter !== 'object' || filter === null) return null;
  const { field, operator, value } = filter as Record<string, unknown>;
  if (typeof field !== 'string' || typeof operator !== 'string') return null;
  const label = OPERATOR_LABELS[operator] ?? operator;
  if (value === undefined) return `${field} ${label}`;
  if (operator === 'between' && Array.isArray(value) && value.length === 2) {
    return `${field} between ${formatValue(value[0])} and ${formatValue(value[1])}`;
  }
  return `${field} ${label} ${Array.isArray(value) ? value.map(formatValue).join(', ') : formatValue(value)}`;
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
