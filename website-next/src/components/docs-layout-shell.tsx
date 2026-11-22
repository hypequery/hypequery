'use client';

import { useMemo } from 'react';
import { DocsLayout } from 'fumadocs-ui/layouts/notebook';
import type { Folder, Node, Root } from 'fumadocs-core/page-tree';
import { HypequeryMascotIcon } from './HypequeryMascotIcon';
import { PersistedFolderLabel } from './docs-sidebar-folder-state';
import { Rocket, Server } from 'lucide-react';
import { SiPython, SiTypescript } from 'react-icons/si';
import { baseOptions } from '@/lib/layout.shared';

// Icons for the top-level sections, keyed by their meta.json titles. Folders
// nested inside a section have none.
const SECTION_ICONS: Record<string, React.ReactNode> = {
  'Getting started': <Rocket className="text-fd-primary" />,
  'TypeScript SDK': <SiTypescript color="#3178C6" />,
  'Python SDK': <SiPython color="#3776AB" />,
  Cloud: <HypequeryMascotIcon className="size-4 scale-125 text-fd-primary" />,
  'Self-hosting': <Server className="text-fd-primary" />,
};

/**
 * One sidebar for every section, cloud-first: Getting started, then Cloud,
 * then the SDKs, then Self-hosting, each a collapsible folder. Getting started
 * and Cloud open by default (their meta.json sets defaultOpen), and each folder
 * remembers whether it is open for the browser session.
 */
function withSections(nodes: Node[], depth = 0): Node[] {
  return nodes.map((node) => {
    if (node.type !== 'folder') return node;
    const id = node.$id ?? (typeof node.name === 'string' ? node.name : String(depth));
    const icon = depth === 0 && typeof node.name === 'string' ? SECTION_ICONS[node.name] : undefined;
    const folder: Folder = {
      ...node,
      icon,
      name: (
        <PersistedFolderLabel id={id}>
          {node.name}
        </PersistedFolderLabel>
      ),
      children: withSections(node.children, depth + 1),
    };
    return folder;
  });
}

export function DocsLayoutShell({
  children,
  tree,
}: {
  children: React.ReactNode;
  tree: Root;
}) {
  const sidebarTree = useMemo<Root>(() => ({ ...tree, children: withSections(tree.children) }), [tree]);

  return (
    <DocsLayout
      {...baseOptions()}
      tree={sidebarTree}
      themeSwitch={{ enabled: true }}
      githubUrl={'https://github.com/hypequery/hypequery'}
    >
      {children}
    </DocsLayout>
  );
}
