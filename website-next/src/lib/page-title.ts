/**
 * Metadata `title` for a page under a "%s | hypequery" template. A search result
 * shows about 65 characters, so when the brand suffix would push the title past
 * that, the title is used on its own: the cut then falls on the suffix, never on
 * the words people searched for.
 */
export const SEARCH_TITLE_MAX = 65;

export function searchTitle(title: string, suffix = ' | hypequery'): string | { absolute: string } {
  return title.length + suffix.length > SEARCH_TITLE_MAX ? { absolute: title } : title;
}
