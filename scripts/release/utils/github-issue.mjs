// Opens the `release-failure` issue, or comments on the one already open, with
// the `gh` CLI. Needs GH_TOKEN (the workflow's GITHUB_TOKEN with
// `issues: write`) and GH_REPO.
//
// Workflows serialize their reports with the `release-failure-issue`
// concurrency group. As a second line of defence, a run that creates the issue
// lists the open ones again afterwards. If two runs raced, the oldest issue is
// kept and the newer ones are closed with a link to it (see
// planDuplicateCleanup in release-issue.mjs).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  alreadyReported,
  duplicateNotice,
  planDuplicateCleanup,
  RELEASE_FAILURE_LABEL,
  RELEASE_FAILURE_TITLE,
} from './release-issue.mjs';

const execFileAsync = promisify(execFile);

/** Run `gh <args>` with optional stdin and return trimmed stdout. */
export async function runGh(args, input) {
  const child = execFileAsync('gh', args, { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
  // Always close stdin: only `--body-file -` reads it.
  child.child.stdin.end(input ?? '');
  const { stdout } = await child;
  return stdout.trim();
}

async function listOpenIssues(gh) {
  const list = JSON.parse(await gh([
    'issue', 'list', '--label', RELEASE_FAILURE_LABEL, '--state', 'open',
    '--json', 'number,url', '--limit', '100',
  ]) || '[]');
  return list.sort((a, b) => a.number - b.number);
}

/** Issue number from the URL `gh issue create` prints. */
function issueNumber(url) {
  const match = /\/issues\/(\d+)\s*$/.exec(url);
  if (!match) throw new Error(`Unexpected gh issue create output: ${url}`);
  return Number(match[1]);
}

/**
 * Report `markdown` on the open release-failure issue, creating the issue (and
 * its label) if none is open. Skips when `marker` was already reported there.
 * Returns `{ action, url }`. `gh` is injectable for tests.
 */
export async function upsertReleaseFailureIssue({ markdown, marker }, { gh = runGh } = {}) {
  await gh([
    'label', 'create', RELEASE_FAILURE_LABEL, '--force', '--color', 'B60205',
    '--description', 'npm publishing or canary freshness is failing',
  ]);
  const [oldest] = await listOpenIssues(gh);
  if (oldest) {
    const open = JSON.parse(await gh(['issue', 'view', String(oldest.number), '--json', 'number,url,body,comments']));
    if (alreadyReported(open, marker)) return { action: 'skipped', url: open.url };
    const url = await gh(['issue', 'comment', String(open.number), '--body-file', '-'], markdown);
    return { action: 'commented', url: url || open.url };
  }

  const createdUrl = await gh([
    'issue', 'create', '--title', RELEASE_FAILURE_TITLE, '--label', RELEASE_FAILURE_LABEL, '--body-file', '-',
  ], markdown);
  const created = issueNumber(createdUrl);

  // Another run may have created one at the same time: keep only the oldest.
  const plan = planDuplicateCleanup(await listOpenIssues(gh), created);
  for (const duplicate of plan.close) {
    try {
      await gh(['issue', 'close', String(duplicate.number), '--reason', 'not planned', '--comment', duplicateNotice(plan.keep)]);
    } catch (error) {
      // The run that created it may have closed it already.
      console.warn(`Could not close duplicate #${duplicate.number}: ${error.message}`);
    }
  }
  if (plan.repostOnKept) {
    const url = await gh(['issue', 'comment', String(plan.keep.number), '--body-file', '-'], markdown);
    return { action: 'commented', url: url || plan.keep.url };
  }
  return { action: 'created', url: createdUrl };
}
