// Every post without an explicit `author` is by the founder. Used for the
// visible byline and for BlogPosting structured data, so the two never drift.
export const DEFAULT_BLOG_AUTHOR = {
  name: 'Luke Reilly',
  url: 'https://github.com/lureilly1',
  sameAs: ['https://dev.to/lureilly1', 'https://medium.com/@lureilly1'],
} as const;

export function blogAuthorName(author?: string | null) {
  return author && author.trim().length > 0 ? author : DEFAULT_BLOG_AUTHOR.name;
}
