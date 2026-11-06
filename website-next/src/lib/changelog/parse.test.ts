import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CHANGELOG_PACKAGES } from './packages';
import { parseChangelog, releaseBump } from './parse';

const changesets = `# @hypequery/serve

## 0.24.4

### Patch Changes

- 934b6ce: Type \`ctx.tenantId\` on the query resolver context.

## 0.24.3

### Patch Changes

- Updated dependencies [86f9207]
  - @hypequery/datasets@0.29.0

## 0.24.1

### Minor Changes

- eb75fc2: Node adapter works inside Express:

  - Routes on \`req.originalUrl\`.
  - Uses a body that an upstream parser already read.

  \`\`\`ts
  - not a list item
  ## not a release
  \`\`\`

### Patch Changes

- Updated dependencies [4847c9c]
- Updated dependencies [17ffe2b]
  - @hypequery/datasets@0.28.0
  - @hypequery/protocol@0.6.0
`;

test('parses Changesets releases, commits, and nested content', () => {
  const releases = parseChangelog(changesets);
  assert.deepEqual(
    releases.map((release) => release.version),
    ['0.24.4', '0.24.3', '0.24.1'],
  );

  assert.deepEqual(releases[0].sections, [
    {
      title: 'Patch Changes',
      changes: [{ markdown: 'Type `ctx.tenantId` on the query resolver context.', commit: '934b6ce' }],
    },
  ]);

  const [minor] = releases[2].sections;
  assert.equal(minor.title, 'Minor Changes');
  assert.equal(minor.changes.length, 1);
  assert.equal(minor.changes[0].commit, 'eb75fc2');
  assert.equal(
    minor.changes[0].markdown,
    [
      'Node adapter works inside Express:',
      '',
      '- Routes on `req.originalUrl`.',
      '- Uses a body that an upstream parser already read.',
      '',
      '```ts',
      '- not a list item',
      '## not a release',
      '```',
    ].join('\n'),
  );
});

test('moves "Updated dependencies" bullets out of the sections', () => {
  const releases = parseChangelog(changesets);
  assert.deepEqual(releases[1].sections, []);
  assert.deepEqual(releases[1].dependencyUpdates, ['@hypequery/datasets@0.29.0']);

  // The Patch Changes section held only dependency bullets, so it is dropped.
  assert.deepEqual(
    releases[2].sections.map((section) => section.title),
    ['Minor Changes'],
  );
  assert.deepEqual(releases[2].dependencyUpdates, ['@hypequery/datasets@0.28.0', '@hypequery/protocol@0.6.0']);
});

test('parses legacy bracketed versions and loose paragraphs', () => {
  const [release] = parseChangelog(`## [1.3.2]

### Features

- teach expressions their result types

**Note:** reorder joins ahead of select clauses.
`);
  assert.equal(release.version, '1.3.2');
  assert.deepEqual(release.sections[0].changes, [
    { markdown: 'teach expressions their result types\n\n**Note:** reorder joins ahead of select clauses.' },
  ]);
});

test('parses towncrier headings with dates and skips Unreleased', () => {
  const releases = parseChangelog(`# Changelog

## Unreleased

- not released yet

<!-- towncrier release notes start -->

## 0.1.0b3 (2026-11-05)

- Datasets can run on embedded ClickHouse:
  \`create_chdb_executor(path)\`.

- New \`hypequery telemetry\` command.
`);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].version, '0.1.0b3');
  assert.equal(releases[0].date, '2026-11-05');
  assert.deepEqual(releases[0].sections, [
    {
      title: '',
      changes: [
        { markdown: 'Datasets can run on embedded ClickHouse:\n`create_chdb_executor(path)`.' },
        { markdown: 'New `hypequery telemetry` command.' },
      ],
    },
  ]);
});

test('merges a version heading that appears twice', () => {
  const releases = parseChangelog(`## 2.0.0

### Major Changes

- abc1234: First note.

## 2.0.0

### Major Changes

- Second note.

### Additional Changes

- Third note.
`);
  assert.equal(releases.length, 1);
  assert.deepEqual(
    releases[0].sections.map((section) => [section.title, section.changes.length]),
    [
      ['Major Changes', 2],
      ['Additional Changes', 1],
    ],
  );
});

test('releaseBump compares against the previous version', () => {
  assert.equal(releaseBump('2.14.0', '2.13.0'), 'minor');
  assert.equal(releaseBump('2.13.1', '2.13.0'), 'patch');
  assert.equal(releaseBump('2.0.0', '1.6.0'), 'major');
  assert.equal(releaseBump('0.24.0', '0.23.3'), 'minor');
  assert.equal(releaseBump('0.1.0b3', '0.1.0b2'), 'prerelease');
  assert.equal(releaseBump('1.0.0-canary.1', '0.9.0'), 'prerelease');
  assert.equal(releaseBump('1.0.0'), 'major');
  assert.equal(releaseBump('1.3.0'), 'minor');
  assert.equal(releaseBump('1.3.2'), 'patch');
});

test('every repository changelog parses into dated or versioned releases', () => {
  const repoRoot = path.resolve(process.cwd(), '..');
  for (const pkg of CHANGELOG_PACKAGES) {
    const releases = parseChangelog(readFileSync(path.join(repoRoot, pkg.changelogPath), 'utf8'));
    assert.ok(releases.length > 0, `${pkg.changelogPath} has no releases`);
    assert.equal(new Set(releases.map((release) => release.version)).size, releases.length, `${pkg.slug} has duplicate versions`);
    for (const release of releases) {
      assert.ok(
        release.sections.length > 0 || release.dependencyUpdates.length > 0,
        `${pkg.slug}@${release.version} parsed empty`,
      );
      for (const section of release.sections) {
        for (const change of section.changes) {
          assert.doesNotMatch(change.markdown, /^[0-9a-f]{7,40}:\s/, `${pkg.slug}@${release.version} kept a commit prefix`);
        }
      }
    }
  }
});
