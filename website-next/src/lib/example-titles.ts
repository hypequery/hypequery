/**
 * The `<title>` for an example, recipe or guide. Manifest titles are written as
 * full sentences for the page heading and often run past the ~65 characters a
 * search result shows, so long ones are shortened: drop the "with a typed
 * dataset" tail (our term, not a search term), then keep the part before a
 * colon. The heading on the page keeps the full manifest title.
 */
const MAX = 53; // 65 characters minus the " | hypequery" suffix

export function exampleSearchTitle(title: string): string {
  if (title.length <= MAX) return title;
  const trimmed = title.replace(/,?\s+(?:with|and|in|as) (?:a )?(?:typed|reusable) dataset(?: query| dimensions)?$/, '');
  if (trimmed.length <= MAX) return trimmed;
  // "..., compared with X and Y" is a detail the page covers, not part of the search.
  const compared = trimmed.replace(/, compared with .*$/, '');
  if (compared !== trimmed && compared.length <= MAX) return compared;
  const colon = trimmed.indexOf(': ');
  if (colon >= 20) return trimmed.slice(0, colon);
  return trimmed;
}
