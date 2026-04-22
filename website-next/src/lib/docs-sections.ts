import type { Root, Node } from 'fumadocs-core/page-tree';

type Section = 'documentation' | 'legacy';

const legacyPages = [
  'legacy-serve/query-definitions.mdx',
  'legacy-serve/authentication.mdx',
  'legacy-serve/multi-tenancy.mdx',
  'legacy-serve/migration-builder-to-serve.mdx',
  'legacy-serve/reference/serve.mdx',
];

export const legacyTabUrls = new Set(
  legacyPages.map((pagePath) => `/docs/${pagePath.replace(/\.mdx$/, '')}`)
);

function getSectionForUrl(url?: string): Section {
  if (!url) {
    return 'documentation';
  }

  if (url.startsWith('/docs/legacy-serve')) {
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

function findRootFolder(nodes: Node[], section: Section): Node | undefined {
  return nodes.find((node) => {
    if (node.type !== 'folder' || node.root !== true) {
      return false;
    }

    const indexMatches = node.index ? getSectionForUrl(node.index.url) === section : false;
    const childMatches = node.children.some((child) => {
      if (child.type === 'page') {
        return getSectionForUrl(child.url) === section;
      }

      if (child.type === 'folder') {
        return child.children.some((grandchild) => {
          return grandchild.type === 'page' && getSectionForUrl(grandchild.url) === section;
        });
      }

      return false;
    });

    return indexMatches || childMatches;
  });
}

export function getSectionTree(tree: Root, section: Section): Root {
  const rootFolder = findRootFolder(tree.children, section);

  if (rootFolder && rootFolder.type === 'folder') {
    return {
      ...tree,
      children: rootFolder.children,
      fallback: undefined,
    };
  }

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
