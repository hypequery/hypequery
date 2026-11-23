import assert from 'node:assert/strict';
import { test } from 'node:test';
import { upsertReleaseFailureIssue } from './github-issue.mjs';
import { eventMarker } from './release-issue.mjs';

/**
 * In-memory stand-in for the `gh` commands the upsert uses. Every call yields
 * first, so two concurrent upserts interleave the way two jobs can.
 */
function fakeGh(issues = []) {
  let next = Math.max(0, ...issues.map((issue) => issue.number)) + 1;
  const url = (number) => `https://github.com/hypequery/hypequery/issues/${number}`;
  const find = (number) => issues.find((issue) => issue.number === Number(number));
  const gh = async (args, input) => {
    await new Promise((resolve) => setImmediate(resolve));
    const [group, command, ...rest] = args;
    if (group === 'label') return '';
    if (command === 'list') {
      return JSON.stringify(issues.filter((issue) => issue.state === 'open').map(({ number }) => ({ number, url: url(number) })));
    }
    if (command === 'view') {
      const issue = find(rest[0]);
      return JSON.stringify({ number: issue.number, url: url(issue.number), body: issue.body, comments: issue.comments });
    }
    if (command === 'create') {
      const issue = { number: next++, state: 'open', body: input, comments: [] };
      issues.push(issue);
      return url(issue.number);
    }
    if (command === 'comment') {
      find(rest[0]).comments.push({ body: input });
      return `${url(rest[0])}#comment`;
    }
    if (command === 'close') {
      const issue = find(rest[0]);
      if (issue.state === 'closed') throw new Error(`issue #${issue.number} is already closed`);
      issue.state = 'closed';
      issue.comments.push({ body: rest[rest.indexOf('--comment') + 1] });
      return '';
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { gh, issues };
}

const report = (job) => ({ markdown: `${eventMarker(job)}\n${job} failed`, marker: eventMarker(job) });

test('two jobs failing together end with one open issue holding both reports', async () => {
  const { gh, issues } = fakeGh();
  const warn = console.warn;
  console.warn = () => {};
  try {
    await Promise.all([
      upsertReleaseFailureIssue(report('canary-release'), { gh }),
      upsertReleaseFailureIssue(report('release'), { gh }),
    ]);
  } finally {
    console.warn = warn;
  }
  const open = issues.filter((issue) => issue.state === 'open');
  assert.equal(issues.length, 2, 'the race did create two issues');
  assert.deepEqual(open.map((issue) => issue.number), [1], 'only the oldest stays open');
  const kept = [open[0].body, ...open[0].comments.map((comment) => comment.body)].join('\n');
  assert.match(kept, /canary-release failed/);
  assert.match(kept, /release failed/);
  assert.match(issues[1].comments.at(-1).body, /Duplicate of #1/);
});

test('an open issue gets a comment, and a repeated report is skipped', async () => {
  const { gh, issues } = fakeGh([{ number: 5, state: 'open', body: 'first', comments: [] }]);
  assert.equal((await upsertReleaseFailureIssue(report('release'), { gh })).action, 'commented');
  assert.equal((await upsertReleaseFailureIssue(report('release'), { gh })).action, 'skipped');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].comments.length, 1);
});

test('with several open issues, reports go to the oldest', async () => {
  const { gh, issues } = fakeGh([
    { number: 9, state: 'open', body: 'newer', comments: [] },
    { number: 4, state: 'open', body: 'older', comments: [] },
  ]);
  await upsertReleaseFailureIssue(report('canary-release'), { gh });
  assert.equal(issues.find((issue) => issue.number === 4).comments.length, 1);
  assert.equal(issues.find((issue) => issue.number === 9).comments.length, 0);
});
