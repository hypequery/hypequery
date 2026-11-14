import { renderBrandImage } from '@/lib/og/brand-card';

const DEFAULT_TITLE = 'Semantic layer for embedded analytics on ClickHouse';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawTitle = searchParams.get('title')?.trim();
  const title = rawTitle && rawTitle.length > 0 ? rawTitle.slice(0, 140) : DEFAULT_TITLE;

  const response = await renderBrandImage({ title });
  // Social cards only: keep /og?title=… URLs out of Google's index. Not blocked in
  // robots.txt, because Twitterbot obeys it and the cards would stop rendering.
  response.headers.set('X-Robots-Tag', 'noindex');
  return response;
}
