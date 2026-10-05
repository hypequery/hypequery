'use client';

import { useMemo } from 'react';
import { DocsLayout } from 'fumadocs-ui/layouts/notebook';
import { getLayoutTabs, type LayoutTab } from 'fumadocs-ui/layouts/shared';
import type { Folder, Node, Root } from 'fumadocs-core/page-tree';
import { SiPython, SiTypescript } from 'react-icons/si';
import { baseOptions } from '@/lib/layout.shared';

// Brand logos for the language switcher, keyed by the language root's title.
const LANGUAGE_ICONS: Record<string, React.ReactNode> = {
  TypeScript: <SiTypescript color="#3178C6" />,
  Python: <SiPython color="#3776AB" />,
};

function withIcon(tab: LayoutTab): LayoutTab {
  return {
    ...tab,
    title: (
      <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5">
        {tab.icon}
        {tab.title}
      </span>
    ),
  };
}

function firstPageUrl(nodes: Node[]): string | undefined {
  for (const node of nodes) {
    if (node.type === 'page' && !node.external) return node.url;
    if (node.type === 'folder') {
      const url = node.index?.url ?? firstPageUrl(node.children);
      if (url) return url;
    }
  }
  return undefined;
}

/**
 * Language roots (`"root": "language"` in meta.json) hold only tab folders, so
 * Fumadocs cannot derive a URL for them. Build their switcher entries here,
 * pointing at the first page in each language.
 */
function languageTabs(tree: Root): LayoutTab[] {
  return tree.children.flatMap((node) => {
    if (node.type !== 'folder' || typeof node.root !== 'string') return [];
    const url = firstPageUrl(node.children);
    if (!url) return [];
    const icon = typeof node.name === 'string' ? LANGUAGE_ICONS[node.name] : undefined;
    return [{ title: node.name, icon: icon ?? node.icon, description: node.description, url, $folder: node as Folder }];
  });
}

export function DocsLayoutShell({
  children,
  tree,
}: {
  children: React.ReactNode;
  tree: Root;
}) {
  const tabs = useMemo(
    () => [
      ...languageTabs(tree),
      ...getLayoutTabs(tree, { transform: withIcon }).filter((tab) => tab.$folder?.root === true),
    ],
    [tree]
  );

  return (
    <DocsLayout
      {...baseOptions()}
      tree={tree}
      tabs={tabs}
      tabMode="navbar"
      themeSwitch={{ enabled: true }}
      githubUrl={'https://github.com/hypequery/hypequery'}
    >
      {children}
    </DocsLayout>
  );
}
