import { renderBrandImage } from '@/lib/og/brand-card';

const DEFAULT_TITLE = 'The analytics backend for ClickHouse';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawTitle = searchParams.get('title')?.trim();
  const title = rawTitle && rawTitle.length > 0 ? rawTitle.slice(0, 140) : DEFAULT_TITLE;

  return renderBrandImage({ title });
}
