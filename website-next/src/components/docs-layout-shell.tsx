'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { Root } from 'fumadocs-core/page-tree';
import { baseOptions } from '@/lib/layout.shared';
import { getSectionFromPathname, getSectionTree } from '@/lib/docs-sections';

export function DocsLayoutShell({
  children,
  tree,
}: {
  children: React.ReactNode;
  tree: Root;
}) {
  const pathname = usePathname();

  const sectionTree = useMemo(() => {
    return getSectionTree(tree, getSectionFromPathname(pathname));
  }, [pathname, tree]);

  return (
    <DocsLayout
      {...baseOptions()}
      tree={sectionTree}
      themeSwitch={{ enabled: false }}
      githubUrl={'https://github.com/hypequery/hypequery'}
    >
      {children}
    </DocsLayout>
  );
}
