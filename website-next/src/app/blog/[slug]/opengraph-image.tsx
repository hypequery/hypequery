import { getPostBySlug } from '@/lib/blog';
import { OG_SIZE, renderBrandImage } from '@/lib/og/brand-card';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'hypequery blog post';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  return renderBrandImage({ title: post?.data.title ?? 'hypequery blog', eyebrow: 'Blog' });
}
