import { source } from '@/lib/meta';
import {
  DocsPage,
  DocsBody,
  DocsDescription,
  DocsTitle,
} from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import { LLMCopyButton, ViewOptions } from '@/components/page-actions';
import type { Metadata } from 'next';
import { absoluteUrl } from '@/lib/site';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (!page) {
    return {};
  }

  const title = typeof page.data.title === 'string' ? page.data.title : 'Documentation';
  const description = page.data.description ?? 'Documentation for hypequery.';

  return {
    title,
    description,
    alternates: {
      canonical: absoluteUrl(page.url),
    },
    openGraph: {
      type: 'article',
      url: absoluteUrl(page.url),
      title,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const Body = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pt-2 pb-6 mb-4">
        <LLMCopyButton markdownUrl={`${page.url}.mdx`} />
        <ViewOptions
          markdownUrl={`${page.url}.mdx`}
          githubUrl={`https://github.com/hypequery/hypequery/blob/main/website-next/docs/${page.path}`}
        />
      </div>
      <DocsBody>
        <Body />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}
