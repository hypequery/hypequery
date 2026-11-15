import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PageWrapper from '@/components/PageWrapper';
import ExampleDetail from '@/components/examples/ExampleDetail';
import { getEntry, examples } from '@/lib/examples';
import { absoluteUrl, ogImage } from '@/lib/site';
import { exampleSearchTitle } from '@/lib/example-titles';
import { searchTitle } from '@/lib/page-title';

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return examples.map((entry) => ({ slug: entry.manifest.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entry = getEntry('example', slug);
  if (!entry) return {};
  const url = absoluteUrl(`/examples/${slug}`);
  const title = exampleSearchTitle(entry.manifest.title);
  const description = entry.manifest.outcome;
  return {
    title: searchTitle(title),
    description,
    keywords: entry.manifest.keywords,
    alternates: {
      canonical: url,
      types: { 'text/markdown': absoluteUrl(`/examples/${slug}.md`).toString() },
    },
    openGraph: { type: 'article', url, title, description, images: ogImage(title) },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function ExamplesDetailPage({ params }: Props) {
  const { slug } = await params;
  const entry = getEntry('example', slug);
  if (!entry) notFound();
  return (
    <PageWrapper>
      <ExampleDetail entry={entry} />
    </PageWrapper>
  );
}
