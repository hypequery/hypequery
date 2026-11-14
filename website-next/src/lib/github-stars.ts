// Server-side GitHub star count for proof sections. Fetched at render time and
// cached for an hour, like the npm download badge, so the number is in the HTML
// and never goes stale in source.

const REPO = 'hypequery/hypequery';
const GITHUB_TIMEOUT_MS = 3000;

/** Stars on the hypequery repository, or null if GitHub is unreachable. */
export async function getGithubStars(): Promise<number | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data: { stargazers_count?: number } = await response.json();
    return typeof data.stargazers_count === 'number' && data.stargazers_count >= 0 ? data.stargazers_count : null;
  } catch {
    return null;
  }
}
