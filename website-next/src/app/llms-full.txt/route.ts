import { getLLMText } from '@/lib/get-llm-text';
import { source } from '@/lib/meta';

// Static, regenerated only at build time.
export const revalidate = false;

// Full doc corpus as one Markdown document for one-shot ingestion by an LLM.
export async function GET() {
  const pages = source.getPages();
  const texts = await Promise.all(pages.map((page) => getLLMText(page)));

  const body = [
    '# hypequery — full documentation',
    '',
    '> Concatenated Markdown for every docs page. See /llms.txt for the indexed list.',
    '',
    texts.join('\n\n---\n\n'),
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
