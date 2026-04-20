import type { Root, Node } from 'fumadocs-core/page-tree';

type Section = 'documentation' | 'legacy';

function collectUrlFromPage(pagePath: string): string {
  return `/docs/${pagePath.replace(/\.mdx$/, '')}`;
}

const legacyPages = [
  'legacy-serve/query-definitions.mdx',
  'legacy-serve/authentication.mdx',
  'legacy-serve/multi-tenancy.mdx',
  'legacy-serve/migration-builder-to-serve.mdx',
  'legacy-serve/reference/serve.mdx',
];

export const legacyTabUrls = new Set(legacyPages.map(collectUrlFromPage));

function getSectionForUrl(url?: string): Section {
  if (!url) {
    return 'documentation';
  }

  if (legacyTabUrls.has(url)) {
    return 'legacy';
  }

  return 'documentation';
}

function filterNodes(nodes: Node[], section: Section): Node[] {
  const filtered: Node[] = [];
  let pendingSeparators: Node[] = [];

  for (const node of nodes) {
    if (node.type === 'separator') {
      pendingSeparators = [node];
      continue;
    }

    if (node.type === 'page') {
      if (getSectionForUrl(node.url) !== section) {
        continue;
      }

      filtered.push(...pendingSeparators, node);
      pendingSeparators = [];
      continue;
    }

    const indexMatches = node.index ? getSectionForUrl(node.index.url) === section : false;
    const children = filterNodes(node.children, section);

    if (!indexMatches && children.length === 0) {
      continue;
    }

    filtered.push(...pendingSeparators, {
      ...node,
      children,
      index: indexMatches ? node.index : undefined,
    });
    pendingSeparators = [];
  }

  return filtered;
}

export function getSectionTree(tree: Root, section: Section): Root {
  const children = filterNodes(tree.children, section);

  return {
    ...tree,
    children,
    fallback: tree.fallback ? getSectionTree(tree.fallback, section) : undefined,
  };
}

export function getSectionFromPathname(pathname: string): Section {
  return getSectionForUrl(pathname);
}
