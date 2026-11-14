import type { Element, Root, RootContent } from 'hast';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

/** Elements that carry no readable content, or only page chrome. */
const DROP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'button', 'form', 'input', 'select', 'textarea', 'nav', 'dialog']);

export type HtmlPage = { title?: string; description?: string; markdown: string };

function isElement(node: RootContent | Root): node is Element {
  return node.type === 'element';
}

function findFirst(node: Root | Element, test: (el: Element) => boolean): Element | undefined {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (test(child)) return child;
    const found = findFirst(child, test);
    if (found) return found;
  }
  return undefined;
}

function textOf(node: Element): string {
  return node.children.map((child) => (child.type === 'text' ? child.value : isElement(child) ? textOf(child) : '')).join('');
}

function isHidden(el: Element): boolean {
  const p = el.properties ?? {};
  return p.hidden === true || p.ariaHidden === 'true';
}

/** A link with no visible text or image, such as an icon-only anchor. */
function isEmptyLink(el: Element): boolean {
  return el.tagName === 'a' && textOf(el).trim() === '' && findFirst(el, (child) => child.tagName === 'img') === undefined;
}

/**
 * Drop chrome, hidden nodes, comments (React's `<!-- -->` text separators) and
 * empty links; make relative links and images absolute against `base`.
 */
function clean(node: Element | Root, base: URL): void {
  node.children = node.children.filter(
    (child) => child.type !== 'comment' && !(isElement(child) && (DROP_TAGS.has(child.tagName) || isHidden(child) || isEmptyLink(child))),
  );
  for (const child of node.children) {
    if (!isElement(child)) continue;
    for (const attr of ['href', 'src'] as const) {
      const value = child.properties?.[attr];
      if (typeof value === 'string' && !value.startsWith('#')) {
        try {
          child.properties[attr] = new URL(value, base).toString();
        } catch {
          // leave unparseable URLs as they are
        }
      }
    }
    clean(child, base);
  }
}

/**
 * Convert a rendered page to Markdown: the `<main>` element only (no header,
 * footer or navigation), with links resolved against `base`.
 */
export function htmlToMarkdown(html: string, base: URL): HtmlPage {
  const tree = unified().use(rehypeParse).parse(html) as Root;
  const title = findFirst(tree, (el) => el.tagName === 'title');
  const description = findFirst(tree, (el) => el.tagName === 'meta' && el.properties?.name === 'description');
  const main = findFirst(tree, (el) => el.tagName === 'main') ?? findFirst(tree, (el) => el.tagName === 'body');

  const body: Root = { type: 'root', children: main ? main.children : [] };
  clean(body, base);

  const processor = unified().use(rehypeRemark).use(remarkGfm).use(remarkStringify, { bullet: '-', fences: true, rule: '-' });
  const markdown = processor.stringify(processor.runSync(body) as never) as string;

  return {
    title: title ? textOf(title).trim() : undefined,
    description: typeof description?.properties?.content === 'string' ? description.properties.content : undefined,
    markdown: markdown.replace(/\n{3,}/g, '\n\n').trim(),
  };
}
