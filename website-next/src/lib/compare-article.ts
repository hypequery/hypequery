import { getPostBySlug } from '@/lib/blog';
import { absoluteUrl } from '@/lib/site';
import { compareArticles } from '@/data/compare-articles';
import type { ComparePageConfig } from '@/data/compare-pages';

export type CompareArticleView = {
  title: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  date?: string;
  tags?: string[];
  content: string;
};

// A compare page's long-form body is either a promoted article in compare-articles.ts
// or the seed blog post with the same slug.
export async function getCompareArticle(slug: string): Promise<CompareArticleView | null> {
  const promotedArticle = compareArticles[slug];
  if (promotedArticle) return promotedArticle;

  const post = await getPostBySlug(slug);
  if (!post) return null;

  return {
    title: post.data.title,
    description: post.data.description,
    seoTitle: post.data.seoTitle,
    seoDescription: post.data.seoDescription,
    date: post.data.date,
    tags: post.data.tags,
    content: post.content,
  };
}

function tableCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// Clean Markdown copy of a compare page for /llms.mdx/compare/<slug>.
export function compareMarkdown(page: ComparePageConfig, article: CompareArticleView) {
  const primary = page.primaryLabel ?? 'hypequery';
  const alternative = page.alternativeLabel ?? 'Alternative';
  const lines = [
    `# ${article.title} (${absoluteUrl(page.href).toString()})`,
    '',
    `**Verdict:** ${page.verdict}`,
    '',
    `| | ${tableCell(primary)} | ${tableCell(alternative)} |`,
    '|---|---|---|',
    ...page.rows.map((row) => `| ${tableCell(row.label)} | ${tableCell(row.hypequery)} | ${tableCell(row.alternative)} |`),
    '',
    article.content.trim(),
  ];

  if (page.faq.length > 0) {
    lines.push('', '## FAQ', '');
    for (const item of page.faq) {
      lines.push(`### ${item.question}`, '', item.answer, '');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}
