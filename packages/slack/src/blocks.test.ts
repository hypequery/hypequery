import { describe, expect, it } from 'vitest';
import { escapeMrkdwn, markdownToMrkdwn, queryResultToTable, renderSlackAnswer, renderSlackError, SLACK_LIMITS } from './blocks.js';

const sectionTexts = (blocks: Record<string, any>[]) => blocks.filter(b => b.type === 'section').map(b => b.text.text as string);

describe('markdownToMrkdwn', () => {
  it('converts the Markdown models write', () => {
    expect(markdownToMrkdwn('## Revenue\n**Up** 12% vs *last* week ~~flat~~')).toBe('*Revenue*\n*Up* 12% vs _last_ week ~flat~');
    expect(markdownToMrkdwn('- one\n* two')).toBe('• one\n• two');
    expect(markdownToMrkdwn('# **Bold heading**')).toBe('*Bold heading*');
    expect(markdownToMrkdwn('See [the docs](https://hypequery.com/docs?a=1&b=2)')).toBe(
      'See <https://hypequery.com/docs?a=1&amp;b=2|the docs>',
    );
  });

  it('drops links that are not http(s)', () => {
    expect(markdownToMrkdwn('[click](javascript:alert(1))')).toBe('click');
    expect(markdownToMrkdwn('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))')).toBe('<https://en.wikipedia.org/wiki/Foo_(bar)|wiki>');
  });

  it('escapes control characters so data cannot ping or link', () => {
    expect(markdownToMrkdwn('<!channel> & <@U1> <https://evil|ok>')).toBe(
      '&lt;!channel&gt; &amp; &lt;@U1&gt; &lt;https://evil|ok&gt;',
    );
  });

  it('leaves code untouched apart from escaping', () => {
    expect(markdownToMrkdwn('Use `**not bold**` here\n```sql\nSELECT a < b\n```')).toBe(
      'Use `**not bold**` here\n```\nSELECT a &lt; b\n```',
    );
  });
});

describe('renderSlackAnswer', () => {
  const rows = [
    { region: 'EU', revenue: 1234567.891, orders: '120' },
    { region: 'US', revenue: 98765, orders: '80' },
    { region: null, revenue: 5, orders: '1' },
  ];

  it('renders a header, text, table, source and link', () => {
    const message = renderSlackAnswer({
      title: 'Revenue by region',
      text: 'EU leads with **$1.2M**.',
      table: { rows, totalRows: 3 },
      source: { dataset: 'orders', filters: ['created_at last 7 days'], requestId: 'req_1' },
      link: { url: 'https://app.hypequery.com/a/1' },
    });
    expect(message.blocks.map(b => b.type)).toEqual(['header', 'section', 'section', 'context', 'actions']);
    expect(message.text).toContain('Revenue by region');

    const table = sectionTexts(message.blocks)[1]!;
    expect(table).toBe(
      [
        '```',
        'region       revenue  orders',
        '------  ------------  ------',
        'EU      1,234,567.89     120',
        'US            98,765      80',
        '—                  5       1',
        '```',
      ].join('\n'),
    );
    const context = (message.blocks[3] as any).elements[0].text as string;
    expect(context).toBe('Dataset `orders` · Filters: created_at last 7 days · Request `req_1`');
    expect((message.blocks[4] as any).elements[0]).toMatchObject({ url: 'https://app.hypequery.com/a/1', action_id: 'hypequery_open' });
  });

  it('says how many rows are shown when the table is cut', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ day: `2026-11-${i}`, n: i }));
    const message = renderSlackAnswer({ table: { rows: many, totalRows: 5000 } }, { maxTableRows: 10 });
    const note = (message.blocks.at(-1) as any).elements[0].text;
    expect(note).toBe('Showing 10 of 5,000 rows');
  });

  it('keeps a wide table inside one section', () => {
    const wide = Array.from({ length: 100 }, (_, i) => ({ a: 'x'.repeat(30), b: 'y'.repeat(30), c: i }));
    const message = renderSlackAnswer({ table: { rows: wide } }, { maxTableRows: 100 });
    expect(sectionTexts(message.blocks)[0]!.length).toBeLessThanOrEqual(SLACK_LIMITS.sectionText);
  });

  it('escapes cell values and truncates long ones', () => {
    const message = renderSlackAnswer({ table: { rows: [{ name: '<!here> ' + 'z'.repeat(50) }] } }, { maxCellWidth: 12 });
    const table = sectionTexts(message.blocks)[0]!;
    expect(table).toContain('&lt;!here&gt; zzz…');
    expect(table).not.toContain('<!here>');
  });

  it('splits long text across sections and caps the block count', () => {
    const long = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} ` + 'w'.repeat(2000)).join('\n\n');
    const message = renderSlackAnswer({ text: long });
    expect(message.blocks.length).toBeLessThanOrEqual(SLACK_LIMITS.blocks);
    for (const text of sectionTexts(message.blocks)) expect(text.length).toBeLessThanOrEqual(SLACK_LIMITS.sectionText);
    expect((message.blocks.at(-1) as any).type).toBe('context');
  });

  it('notes an empty result and hides SQL unless asked', () => {
    const empty = renderSlackAnswer({ table: { rows: [] }, source: { sql: 'SELECT 1' } });
    expect(JSON.stringify(empty.blocks)).toContain('no rows');
    expect(JSON.stringify(empty.blocks)).not.toContain('SELECT 1');
    const withSql = renderSlackAnswer({ source: { sql: 'SELECT a < 1' } }, { showSql: true });
    expect(sectionTexts(withSql.blocks)[0]).toBe('```\nSELECT a &lt; 1\n```');
  });

  it('skips unsafe links and gives a fallback text', () => {
    const message = renderSlackAnswer({ link: { url: 'javascript:alert(1)' } });
    expect(message.blocks).toEqual([]);
    expect(message.text).toBe('Here is your answer.');
  });

  it('uses explicit columns, labels and formatters', () => {
    const message = renderSlackAnswer({
      table: {
        rows: [{ r: 0.1234 }],
        columns: [{ key: 'r', label: 'Rate', format: v => `${((v as number) * 100).toFixed(1)}%` }],
      },
    });
    expect(sectionTexts(message.blocks)[0]).toBe('```\n Rate\n-----\n12.3%\n```');
  });
});

describe('renderSlackError', () => {
  it('escapes and includes the request id', () => {
    const message = renderSlackError({ message: 'No access to <orders>', hint: 'Ask an admin', requestId: 'req_9' });
    expect(sectionTexts(message.blocks)[0]).toBe(':warning: No access to &lt;orders&gt;');
    expect((message.blocks[1] as any).elements[0].text).toBe('Ask an admin');
  });
});

describe('queryResultToTable', () => {
  it('reads tool envelopes, JSON strings and row arrays', () => {
    expect(queryResultToTable({ data: [{ a: 1 }], meta: { rowCount: 10 } })).toEqual({ rows: [{ a: 1 }], totalRows: 10 });
    expect(queryResultToTable(JSON.stringify({ data: [{ a: 1 }], meta: {} }))).toEqual({ rows: [{ a: 1 }], totalRows: undefined });
    expect(queryResultToTable([{ a: 1 }])).toEqual({ rows: [{ a: 1 }] });
    expect(queryResultToTable({ nope: true })).toBeNull();
    expect(queryResultToTable('text')).toBeNull();
  });
});

describe('escapeMrkdwn', () => {
  it('escapes &, < and >', () => {
    expect(escapeMrkdwn('a & <b>')).toBe('a &amp; &lt;b&gt;');
  });
});
