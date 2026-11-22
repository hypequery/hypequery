// Opens the `release-failure` issue, or comments on the one already open, with
// the `gh` CLI. Needs GH_TOKEN (the workflow's GITHUB_TOKEN with
// `issues: write`) and GH_REPO.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { alreadyReported, RELEASE_FAILURE_LABEL, RELEASE_FAILURE_TITLE } from './release-issue.mjs';

const execFileAsync = promisify(execFile);

async function gh(args, input) {
  const child = execFileAsync('gh', args, { maxBuffer: 16 * 1024 * 1024 });
  // Always close stdin: only `--body-file -` reads it.
  child.child.stdin.end(input ?? '');
  const { stdout } = await child;
  return stdout.trim();
}

async function openReleaseFailureIssue() {
  const list = JSON.parse(await gh([
    'issue', 'list', '--label', RELEASE_FAILURE_LABEL, '--state', 'open',
    '--json', 'number,url', '--limit', '1',
  ]) || '[]');
  if (list.length === 0) return null;
  const issue = JSON.parse(await gh(['issue', 'view', String(list[0].number), '--json', 'number,url,body,comments']));
  return issue;
}

/**
 * Report `markdown` on the open release-failure issue, creating the issue (and
 * its label) if none is open. Skips when `marker` was already reported there.
 * Returns `{ action, url }`.
 */
export async function upsertReleaseFailureIssue({ markdown, marker }) {
  await gh([
    'label', 'create', RELEASE_FAILURE_LABEL, '--force', '--color', 'B60205',
    '--description', 'npm publishing or canary freshness is failing',
  ]);
  const open = await openReleaseFailureIssue();
  if (open && alreadyReported(open, marker)) return { action: 'skipped', url: open.url };
  if (open) {
    const url = await gh(['issue', 'comment', String(open.number), '--body-file', '-'], markdown);
    return { action: 'commented', url: url || open.url };
  }
  const url = await gh([
    'issue', 'create', '--title', RELEASE_FAILURE_TITLE, '--label', RELEASE_FAILURE_LABEL, '--body-file', '-',
  ], markdown);
  return { action: 'created', url };
}
