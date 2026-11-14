/** A post's update date when it is newer than its publish date, else the publish date. */
export function blogLastModified(updated: string | undefined, published: string | undefined): Date | undefined {
  const u = updated?.slice(0, 10);
  const p = published?.slice(0, 10);
  const date = u && (!p || u > p) ? u : p;
  return date ? new Date(date) : undefined;
}
