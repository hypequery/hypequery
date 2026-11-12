import { getPostBySlug, getPosts } from '@/lib/blog';
import { markdownNotFound, markdownResponse } from '@/lib/examples-markdown';
import { absoluteUrl } from '@/lib/site';

export const revalidate = false;

export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return markdownNotFound(`/blog/${slug}`);
  const url = absoluteUrl(`/blog/${slug}`).toString();
  const lines = [
    `[hypequery](${absoluteUrl('/').toString()}) › [Blog](${absoluteUrl('/blog').toString()}) › ${post.data.title}`,
    `Index for agents: ${absoluteUrl('/llms.txt').toString()}`,
    '',
    `# ${post.data.title} (${url})`,
    '',
    post.data.description ?? '',
    '',
    post.content.trim(),
    '',
  ];
  return markdownResponse(`${lines.join('\n').trim()}\n`);
}
