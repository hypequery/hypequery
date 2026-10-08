export type ChartKind = 'bars' | 'line' | 'columns';

export type Point = { label: string; value: number };

export type Exchange = {
  question: string;
  /** What the hypequery MCP tool call asked for. */
  tool: string;
  /** First line of Claude's answer. */
  heading: string;
  chart: ChartKind;
  points: Point[];
  /** Values are changes, so they carry a sign. */
  signed?: boolean;
  reply: { lead: string; strong: string; tail: string };
};

// One story, three questions. Last month (Sep) totals $128,000 everywhere,
// and the plan changes add up to the Aug to Sep increase.
export const EXCHANGES: Exchange[] = [
  {
    question: 'What was revenue by country last month?',
    tool: 'orders · revenue by country · last month',
    heading: 'Revenue by country, last month',
    chart: 'bars',
    points: [
      { label: 'GB', value: 64000 },
      { label: 'US', value: 48000 },
      { label: 'DE', value: 16000 },
    ],
    reply: { lead: 'GB led last month with ', strong: '$64,000', tail: '.' },
  },
  {
    question: 'How has revenue trended over six months?',
    tool: 'orders · revenue by month · last 6 months',
    heading: 'Revenue by month',
    chart: 'line',
    points: [
      { label: 'Apr', value: 72000 },
      { label: 'May', value: 81000 },
      { label: 'Jun', value: 88000 },
      { label: 'Jul', value: 97000 },
      { label: 'Aug', value: 104000 },
      { label: 'Sep', value: 128000 },
    ],
    reply: { lead: 'Revenue grew every month, up ', strong: '78%', tail: ' since April.' },
  },
  {
    question: 'Which plan drove the jump in September?',
    tool: 'orders · revenue change by plan · Sep vs Aug',
    heading: 'Revenue change by plan, Sep vs Aug',
    chart: 'columns',
    signed: true,
    points: [
      { label: 'Enterprise', value: 17000 },
      { label: 'Pro', value: 6000 },
      { label: 'Starter', value: 1000 },
    ],
    reply: { lead: 'Enterprise drove most of it: ', strong: '+$17,000', tail: ' of the $24,000 increase.' },
  },
];

export function formatUsd(value: number, signed = false): string {
  const formatted = `$${Math.abs(value).toLocaleString('en-US')}`;
  if (!signed) return formatted;
  return value < 0 ? `-${formatted}` : `+${formatted}`;
}

const SPARK_CHARS = '▁▂▃▄▅▆▇█';

/** A one-line Unicode sparkline, as a terminal would draw it. */
export function sparkline(values: number[]): string {
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  return values
    .map((value) => SPARK_CHARS[Math.round(((value - min) / range) * (SPARK_CHARS.length - 1))])
    .join('');
}

/** A text bar scaled against the largest value, at most `width` blocks. */
export function textBar(value: number, max: number, width = 14): string {
  return '█'.repeat(Math.max(1, Math.round((value / max) * width)));
}
