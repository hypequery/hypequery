import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseAnchor, releasePath, formatReleaseDate, sectionLabel, truncateSections } from './display';
import { buildChangelogFeed, releaseHtml } from './feed';
import { groupByDay, isDependencyOnly, latestVersionBySlug, sortTimeline, type TimelineRelease } from './timeline';

function release(packageSlug: string, version: string, publishedAt?: string, sections: unknown[] = [{}]): TimelineRelease {
  return { packageSlug, version, publishedAt, sections };
}

test('sortTimeline orders by publish time, then package order, undated last', () => {
  const sorted = sortTimeline(
    {
      serve: [release('serve', '0.24.4', '2026-11-05T10:00:00.000Z'), release('serve', '0.1.0')],
      clickhouse: [
        release('clickhouse', '2.14.0', '2026-11-05T10:00:00.000Z'),
        release('clickhouse', '2.13.0', '2026-10-01T08:00:00.000Z'),
      ],
      python: [release('python', '0.1.0b3', '2026-11-06T00:00:00.000Z')],
    },
    ['clickhouse', 'serve', 'python'],
  );
  assert.deepEqual(
    sorted.map((entry) => `${entry.packageSlug}@${entry.version}`),
    ['python@0.1.0b3', 'clickhouse@2.14.0', 'serve@0.24.4', 'clickhouse@2.13.0', 'serve@0.1.0'],
  );
});

test('groupByDay groups consecutive releases by UTC day', () => {
  const days = groupByDay([
    release('a', '1', '2026-11-05T23:00:00.000Z'),
    release('b', '1', '2026-11-05T01:00:00.000Z'),
    release('a', '0', '2026-11-04T12:00:00.000Z'),
    release('c', '0'),
  ]);
  assert.deepEqual(
    days.map((day) => [day.day, day.releases.length]),
    [
      ['2026-11-05', 2],
      ['2026-11-04', 1],
      [null, 1],
    ],
  );
});

test('dependency-only releases and latest versions', () => {
  assert.equal(isDependencyOnly(release('serve', '0.24.3', undefined, [])), true);
  assert.equal(isDependencyOnly(release('serve', '0.24.4')), false);
  assert.deepEqual(latestVersionBySlug({ serve: [{ version: '0.24.4' }, { version: '0.24.3' }], react: [] }), {
    serve: '0.24.4',
    react: undefined,
  });
});

test('display helpers', () => {
  assert.equal(releaseAnchor('python', '0.1.0b3'), 'python-0-1-0b3');
  assert.equal(releasePath('serve', '0.24.4'), '/changelog/serve#serve-0-24-4');
  assert.equal(formatReleaseDate('2026-11-05'), 'November 5, 2026');
  assert.equal(formatReleaseDate('2026-11-05T23:59:00.000Z'), 'November 5, 2026');
  assert.equal(sectionLabel('Minor Changes'), 'Minor changes');
  assert.equal(sectionLabel(''), '');
});

test('truncateSections keeps the first changes across sections', () => {
  const sections = [
    { title: 'Minor Changes', changes: ['a', 'b'] },
    { title: 'Patch Changes', changes: ['c', 'd', 'e'] },
  ];
  assert.deepEqual(truncateSections(sections, 3), {
    sections: [
      { title: 'Minor Changes', changes: ['a', 'b'] },
      { title: 'Patch Changes', changes: ['c'] },
    ],
    hidden: 2,
  });
  assert.deepEqual(truncateSections(sections, 1).sections.map((section) => section.title), ['Minor Changes']);
  assert.deepEqual(truncateSections(sections), { sections, hidden: 0 });
});

test('feed renders markdown, drops raw HTML, and keeps CDATA closed', () => {
  const html = releaseHtml([
    {
      title: 'Patch Changes',
      changes: [{ markdown: 'Fix `a]]>b` and <script>alert(1)</script> **bold**', commit: 'abc1234' }],
    },
  ]);
  assert.match(html, /<h3>Patch changes<\/h3>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /commit\/abc1234/);

  const xml = buildChangelogFeed(
    { title: 'T & co', description: 'D', siteUrl: 'https://hypequery.com/changelog', feedUrl: 'https://hypequery.com/changelog/rss.xml' },
    [
      {
        title: '@hypequery/serve 0.24.4',
        url: 'https://hypequery.com/changelog/serve#serve-0-24-4',
        publishedAt: '2026-11-05T10:00:00.000Z',
        category: '@hypequery/serve',
        sections: [{ title: '', changes: [{ markdown: 'x ]]> y' }] }],
      },
    ],
  );
  assert.match(xml, /<title>T &amp; co<\/title>/);
  assert.match(xml, /<pubDate>Thu, 05 Nov 2026 10:00:00 GMT<\/pubDate>/);
  // The `]]>` in the content is split across CDATA sections; joining them back gives the original HTML.
  const description = /<description><!\[CDATA\[([\s\S]*)\]\]><\/description>/.exec(xml);
  assert.ok(description, 'description CDATA present');
  assert.equal(
    description[1].replaceAll(']]]]><![CDATA[>', ']]>'),
    releaseHtml([{ title: '', changes: [{ markdown: 'x ]]> y' }] }]),
  );
});
