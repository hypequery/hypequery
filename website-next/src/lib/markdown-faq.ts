import type { FaqItem } from '@/lib/faq-schema';

const SECTION = /^## (Quick answers|FAQ|Frequently asked questions)\s*$/i;

/** Markdown inline syntax reduced to plain text: links keep their label; code, emphasis and HTML marks go. */
function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The questions in a post's "Quick answers" or "FAQ" section: each `### ...?`
 * heading with the prose under it, up to the next heading. Code blocks are
 * left out of the answer. Used for FAQPage data that matches the visible text.
 */
export function markdownFaq(markdown: string): FaqItem[] {
  const items: FaqItem[] = [];
  let inSection = false;
  let inFence = false;
  let current: { question: string; lines: string[] } | null = null;
  const flush = () => {
    if (current) {
      const answer = plainText(current.lines.join('\n'));
      if (answer) items.push({ question: current.question, answer });
    }
    current = null;
  };
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.startsWith('## ')) {
      flush();
      inSection = SECTION.test(line);
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith('### ')) {
      flush();
      const heading = line.slice(4).trim();
      if (heading.endsWith('?')) current = { question: plainText(heading), lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return items;
}
