// Text for the single open `release-failure` issue. Every failure (a publish
// job on main, a stale canary) opens it or comments on it, so one place shows
// the history until someone fixes the cause and closes the issue.

import { packageSpec } from './publishable-packages.mjs';

export const RELEASE_FAILURE_LABEL = 'release-failure';
export const RELEASE_FAILURE_TITLE = 'npm release failing: packages are not reaching npm';

/** Hidden marker so the same event is never reported twice on one issue. */
export function eventMarker(key) {
  return `<!-- release-guard:${key} -->`;
}

export function alreadyReported(issue, marker) {
  if (!issue) return false;
  const texts = [issue.body ?? '', ...(issue.comments ?? []).map((comment) => comment.body ?? '')];
  return texts.some((text) => text.includes(marker));
}

const RUNBOOK = 'See `release-commands.md` ("Release guardrails") for causes and fixes.';

/**
 * Body for a failed publish job. `missing` are versions that do not resolve on
 * npm; `resolved` are versions the job meant to publish that are present.
 */
export function publishFailureMarkdown({ job, runUrl, sha, missing, resolved, unknownExpected, marker }) {
  const lines = [
    marker,
    `### \`${job}\` failed on \`main\``,
    '',
    `- Run: ${runUrl}`,
    sha ? `- Commit: \`${sha}\`` : null,
    '',
  ].filter((line) => line !== null);

  if (unknownExpected) {
    lines.push('The job failed before it recorded which versions it would publish, so no package list is available. Open the run for the error.');
  } else if (missing.length > 0) {
    lines.push('These versions do not resolve on npm:', '');
    for (const pkg of missing) lines.push(`- \`${packageSpec(pkg)}\`${pkg.reason ? `: ${pkg.reason}` : ''}`);
  } else {
    lines.push('Every version this job meant to publish resolves on npm, so the failure is elsewhere in the job. Open the run for the error.');
  }
  if (resolved.length > 0) {
    lines.push('', `Published and resolving: ${resolved.map((pkg) => `\`${packageSpec(pkg)}\``).join(', ')}.`);
  }
  lines.push('', 'An `E404` or `ENEEDAUTH` on `PUT` usually means the trusted publisher for that package is missing or does not match `hypequery/hypequery` + `ci.yml`.', RUNBOOK);
  return lines.join('\n');
}

export function canaryStaleMarkdown({ packageName, canaryVersion, canaryTime, commit, lagDays, thresholdDays, runUrl, marker }) {
  return [
    marker,
    `### \`${packageName}\` canary is stale`,
    '',
    `- \`canary\` dist-tag: \`${canaryVersion ?? 'missing'}\`${canaryTime ? `, published ${canaryTime}` : ''}`,
    `- Latest \`main\` commit touching a published package: \`${commit.sha}\` at ${commit.time}`,
    `- Lag: ${lagDays.toFixed(1)} days (threshold ${thresholdDays} days)`,
    runUrl ? `- Check run: ${runUrl}` : null,
    '',
    'Every push to `main` should publish a canary, so canary publishing has been failing or skipped. Check recent `CI Build and Release` runs on `main` for the `canary-release` job.',
    RUNBOOK,
  ].filter((line) => line !== null).join('\n');
}

/**
 * After this run created issue `createdNumber`, decide how to resolve a race
 * with another run that created one too. `openIssues` are the open
 * release-failure issues (`{ number, url }`). The oldest (lowest number) is
 * kept and every newer one is closed. If this run's own issue is closed, its
 * report is reposted on the kept one, so no report is lost.
 */
export function planDuplicateCleanup(openIssues, createdNumber) {
  const byNumber = new Map(openIssues.map((issue) => [issue.number, issue]));
  if (!byNumber.has(createdNumber)) byNumber.set(createdNumber, { number: createdNumber });
  const [keep, ...close] = [...byNumber.values()].sort((a, b) => a.number - b.number);
  return { keep, close, repostOnKept: keep.number !== createdNumber };
}

export function duplicateNotice(keep) {
  return `Duplicate of #${keep.number}: two release jobs reported at the same time. Reports continue there.`;
}
