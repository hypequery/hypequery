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
import { absoluteUrl, ogImage } from '@/lib/site';
import { docsPageTitle } from '@/lib/docs-section-label';
import { softwareApplicationSchema, softwareSourceCodeSchema, WHAT_IS_URL } from '@/data/product';

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

  // TypeScript, Python, and Cloud share page names (Measures, Quick start), so the browser and search
  // title carries the section or a frontmatter `seoTitle`; the sidebar keeps the short name.
  const title = docsPageTitle(page);
  const description = page.data.description ?? 'Documentation for hypequery.';
  const markdownUrl = `/llms.mdx${page.url}`;

  return {
    title,
    description,
    alternates: {
      canonical: absoluteUrl(page.url),
      // Advertise the clean Markdown copy so agents can fetch prose instead of HTML.
      types: { 'text/markdown': absoluteUrl(markdownUrl).toString() },
    },
    openGraph: {
      type: 'article',
      url: absoluteUrl(page.url),
      title: `${title} | hypequery docs`,
      description,
      images: ogImage(title),
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | hypequery docs`,
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
      {page.url === WHAT_IS_URL && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [softwareApplicationSchema, softwareSourceCodeSchema],
            }),
          }}
        />
      )}
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
