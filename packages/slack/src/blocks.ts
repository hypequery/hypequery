/**
 * Render an analytics answer as a Slack message: Block Kit `blocks` plus the
 * plain `text` Slack shows in notifications and screen readers.
 *
 * Everything that reaches Slack is escaped (`&`, `<`, `>`), so neither model
 * output nor data values can produce `@channel`, user mentions or links Slack
 * did not get from us. The renderer keeps within Block Kit limits: 50 blocks,
 * 3000 characters per section, 150 per header.
 */

export type SlackBlock = Record<string, unknown>;

export interface SlackMessage {
  /** Notification and accessibility fallback. */
  text: string;
  blocks: SlackBlock[];
}

export interface SlackAnswerColumn {
  key: string;
  /** Header text. @default key */
  label?: string;
  /** @default 'right' for columns whose values are all numbers, else 'left' */
  align?: 'left' | 'right';
  /** Format a cell. @default numbers with locale grouping, null as `—` */
  format?: (value: unknown) => string;
}

export interface SlackAnswerTable {
  rows: Record<string, unknown>[];
  /** Columns to show, in order. @default the keys of the first row */
  columns?: SlackAnswerColumn[];
  /** Rows the query returned in total, when more than `rows.length`. */
  totalRows?: number;
}

export interface SlackAnswerSource {
  dataset?: string;
  /** Human-readable filters, such as `region = EU`. */
  filters?: string[];
  /** hypequery's request id for this result, for "explain this answer". */
  requestId?: string;
  /** Shown only with `showSql`. */
  sql?: string;
}

export interface SlackAnswer {
  /** A short heading. */
  title?: string;
  /** The model's answer, in Markdown. Converted to Slack mrkdwn. */
  text?: string;
  table?: SlackAnswerTable;
  source?: SlackAnswerSource;
  /** A button, for example "Open in hypequery". http(s) only. */
  link?: { url: string; label?: string };
}

export interface RenderOptions {
  /** @default 20 */
  maxTableRows?: number;
  /** @default 32 */
  maxCellWidth?: number;
  /** Show `source.sql` as a code block. @default false */
  showSql?: boolean;
  /** For number formatting. @default 'en-US' */
  locale?: string;
  /** Blocks to leave free for the caller to append, such as a note. @default 0 */
  reserveBlocks?: number;
}

export const SLACK_LIMITS = {
  blocks: 50,
  sectionText: 3000,
  headerText: 150,
  contextElements: 10,
  buttonText: 75,
  url: 3000,
} as const;

export function renderSlackAnswer(answer: SlackAnswer, options: RenderOptions = {}): SlackMessage {
  const blocks: SlackBlock[] = [];
  const fallback: string[] = [];

  if (answer.title) {
    const title = truncate(answer.title.replace(/\s+/g, ' ').trim(), SLACK_LIMITS.headerText);
    blocks.push({ type: 'header', text: { type: 'plain_text', text: title, emoji: true } });
    fallback.push(escapeMrkdwn(title));
  }

  if (answer.text?.trim()) {
    const mrkdwn = markdownToMrkdwn(answer.text);
    for (const chunk of splitText(mrkdwn, SLACK_LIMITS.sectionText)) blocks.push(section(chunk));
    // The fallback is parsed as mrkdwn too (notifications, screen readers).
    fallback.push(escapeMrkdwn(answer.text.trim()));
  }

  if (answer.table && answer.table.rows.length > 0) {
    const { code, shown, hiddenColumns } = renderTable(answer.table, options);
    blocks.push(section(code));
    const total = Math.max(answer.table.totalRows ?? 0, answer.table.rows.length);
    const notes: string[] = [];
    if (shown < total) notes.push(`Showing ${shown} of ${formatCount(total, options.locale)} rows`);
    if (hiddenColumns > 0) notes.push(`${formatCount(hiddenColumns, options.locale)} ${hiddenColumns === 1 ? 'column' : 'columns'} hidden to fit`);
    if (notes.length > 0) blocks.push(context([notes.join(' · ')]));
  } else if (answer.table) {
    blocks.push(context(['The query returned no rows.']));
  }

  if (options.showSql && answer.source?.sql) {
    blocks.push(section(codeBlock(truncateEscaped(escapeMrkdwn(answer.source.sql), SLACK_LIMITS.sectionText - 8))));
  }

  const sourceLine = renderSource(answer.source);
  if (sourceLine.length > 0) blocks.push(context(sourceLine));

  const link = answer.link && safeUrl(answer.link.url);
  if (link) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: truncate(answer.link!.label ?? 'Open in hypequery', SLACK_LIMITS.buttonText) },
          url: link,
          action_id: 'hypequery_open',
        },
      ],
    });
  }

  const maxBlocks = SLACK_LIMITS.blocks - Math.min(Math.max(0, options.reserveBlocks ?? 0), SLACK_LIMITS.blocks - 1);
  if (blocks.length > maxBlocks) {
    blocks.splice(maxBlocks - 1, blocks.length, context(['Answer shortened to fit in Slack.']));
  }

  return { text: truncateEscaped(fallback.join('\n') || 'Here is your answer.', 3000), blocks };
}

export interface SlackErrorInput {
  message: string;
  hint?: string;
  requestId?: string;
}

/** A short, safe error reply. Never put raw exception text from the server here. */
export function renderSlackError(error: SlackErrorInput): SlackMessage {
  // Escape first, then shorten: escaping can make the text up to five times longer.
  const message = truncateEscaped(escapeMrkdwn(error.message), 2900);
  const blocks: SlackBlock[] = [section(`:warning: ${message}`)];
  const footer = [error.hint ? escapeMrkdwn(error.hint) : null, error.requestId ? `Request \`${escapeMrkdwn(error.requestId)}\`` : null].filter(
    (part): part is string => part !== null,
  );
  if (footer.length > 0) blocks.push(context(footer));
  return { text: message, blocks };
}

/**
 * Read a `query_dataset` / `query_metric` result (`{ data, meta: { rowCount } }`),
 * or a bare row array, into a table. Returns `null` for anything else.
 */
export function queryResultToTable(result: unknown): SlackAnswerTable | null {
  const value = typeof result === 'string' ? safeJson(result) : result;
  if (Array.isArray(value)) return value.every(isRecord) ? { rows: value } : null;
  if (!isRecord(value) || !Array.isArray(value.data) || !value.data.every(isRecord)) return null;
  const meta = isRecord(value.meta) ? value.meta : {};
  const rowCount = typeof meta.rowCount === 'number' ? meta.rowCount : undefined;
  return { rows: value.data, totalRows: rowCount };
}

// ---------------------------------------------------------------------------
// Text

/** Escape the three characters Slack treats as control characters. */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert the Markdown models write into Slack mrkdwn: bold, italics,
 * strikethrough, links (http/https only), headings and bullets. Code spans and
 * fenced blocks are left as they are (escaped only).
 */
export function markdownToMrkdwn(markdown: string): string {
  const escaped = escapeMrkdwn(markdown.replace(/\r\n?/g, '\n').trim());
  // Split out fenced blocks and inline code so formatting is never applied inside them.
  return escaped
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((part, index) => (index % 2 === 1 ? normalizeFence(part) : convertInline(part)))
    .join('');
}

function normalizeFence(part: string): string {
  // Slack ignores a language tag after ``` and would show it as text.
  return part.startsWith('```') ? part.replace(/^```[\w+-]*\n/, '```\n') : part;
}

function convertInline(text: string): string {
  // Bullets before italics, so `* item` is not read as emphasis; headings
  // last, so their `*bold*` output is not read as italics.
  return text
    .replace(/^([ \t]*)[-*+][ \t]+/gm, '$1• ')
    .replace(/(^|[^*\w])\*(?!\*)([^*\n]+?)\*(?!\*)(?=[^*\w]|$)/g, '$1_$2_')
    .replace(/\*\*([^*\n]+?)\*\*/g, '*$1*')
    .replace(/__([^_\n]+?)__/g, '*$1*')
    .replace(/~~([^~\n]+?)~~/g, '~$1~')
    .replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (match, label: string, url: string) => {
      const safe = safeUrl(url.replace(/&amp;/g, '&'));
      return safe ? `<${safe.replace(/&/g, '&amp;')}|${label.replace(/\|/g, '/')}>` : label;
    })
    .replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, (_match, heading: string) => `*${heading.replace(/^\*+|\*+$/g, '')}*`);
}

// ---------------------------------------------------------------------------
// Table

function renderTable(
  table: SlackAnswerTable,
  options: RenderOptions,
): { code: string; shown: number; hiddenColumns: number } {
  const locale = options.locale ?? 'en-US';
  const maxRows = Math.max(1, options.maxTableRows ?? 20);
  const maxWidth = Math.max(4, options.maxCellWidth ?? 32);
  const firstRow = table.rows[0] ?? {};
  const allColumns: SlackAnswerColumn[] = table.columns ?? Object.keys(firstRow).map(key => ({ key }));

  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const formatCell = (column: SlackAnswerColumn, value: unknown): string => {
    const raw = column.format
      ? column.format(value)
      : value === null || value === undefined
        ? '—'
        : typeof value === 'number' || typeof value === 'bigint'
          ? numberFormat.format(value)
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
    return truncate(raw.replace(/\s+/g, ' '), maxWidth);
  };

  const rows = table.rows.slice(0, maxRows);
  // Keep the escaped code block within one section, header and separator included.
  const budget = SLACK_LIMITS.sectionText - 8;
  const allHeader = allColumns.map(column => truncate(column.label ?? column.key, maxWidth));
  const allCells = rows.map(row => allColumns.map(column => formatCell(column, row[column.key])));
  const allWidths = allHeader.map((label, i) => Math.max(label.length, ...allCells.map(row => row[i]!.length)));
  // Drop trailing columns until the header and separator fit, always keeping the first.
  const headerCost = (count: number) => {
    const widths = allWidths.slice(0, count);
    const head = allHeader.slice(0, count).map((label, i) => label.padEnd(widths[i]!)).join('  ').trimEnd();
    return escapeMrkdwn(`${head}\n${widths.map(width => '-'.repeat(width)).join('  ')}`).length;
  };
  let columnCount = allColumns.length;
  while (columnCount > 1 && headerCost(columnCount) > budget) columnCount--;
  const columns = allColumns.slice(0, columnCount);
  const header = allHeader.slice(0, columnCount);
  const cells = allCells.map(row => row.slice(0, columnCount));
  const aligns = columns.map(
    column =>
      column.align ??
      (rows.length > 0 && rows.every(row => isNumeric(row[column.key]) || row[column.key] == null) ? 'right' : 'left'),
  );
  const widths = header.map((label, i) => Math.max(label.length, ...cells.map(row => row[i]!.length)));

  const line = (values: string[]) =>
    values.map((value, i) => (aligns[i] === 'right' ? value.padStart(widths[i]!) : value.padEnd(widths[i]!))).join('  ').trimEnd();

  const lines = [line(header), widths.map(width => '-'.repeat(width)).join('  ')];
  let shown = 0;
  let length = escapeMrkdwn(lines.join('\n')).length;
  for (const row of cells) {
    const next = escapeMrkdwn(line(row)).length + 1;
    if (length + next > budget) break;
    lines.push(line(row));
    length += next;
    shown++;
  }
  return { code: codeBlock(escapeMrkdwn(lines.join('\n'))), shown, hiddenColumns: allColumns.length - columnCount };
}

function isNumeric(value: unknown): boolean {
  return (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()))
  );
}

// ---------------------------------------------------------------------------
// Blocks

function renderSource(source: SlackAnswerSource | undefined): string[] {
  if (!source) return [];
  const parts: string[] = [];
  if (source.dataset) parts.push(`Dataset \`${escapeMrkdwn(source.dataset)}\``);
  if (source.filters && source.filters.length > 0) {
    parts.push(`Filters: ${escapeMrkdwn(truncate(source.filters.join(', '), 500))}`);
  }
  if (source.requestId) parts.push(`Request \`${escapeMrkdwn(source.requestId)}\``);
  return parts.length > 0 ? [parts.join(' · ')] : [];
}

function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text, verbatim: true } };
}

function context(texts: string[]): SlackBlock {
  return {
    type: 'context',
    elements: texts.slice(0, SLACK_LIMITS.contextElements).map(text => ({
      type: 'mrkdwn',
      text: truncateEscaped(text, SLACK_LIMITS.sectionText),
      verbatim: true,
    })),
  };
}

function codeBlock(text: string): string {
  return '```\n' + text.replace(/```/g, "'''") + '\n```';
}

/** Split at paragraph, then line, then hard boundaries, never inside a fenced block when avoidable. */
function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = entitySafeCut(rest, max);
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** `truncate` for escaped text: never ends inside `&amp;`, `&lt;` or `&gt;`. */
function truncateEscaped(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, entitySafeCut(text, Math.max(0, max - 1)))}…`;
}

/** `at`, moved back to the start of an escape entity it would split. */
function entitySafeCut(text: string, at: number): number {
  const amp = text.lastIndexOf('&', at - 1);
  if (amp === -1) return at;
  const entity = /^&(?:amp|lt|gt);/.exec(text.slice(amp, amp + 5));
  return entity && amp + entity[0].length > at ? amp : at;
}

function formatCount(value: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale).format(value);
}

function safeUrl(url: string): string | null {
  if (url.length > SLACK_LIMITS.url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
