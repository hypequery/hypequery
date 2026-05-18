'use client';

import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { Root } from 'fumadocs-core/page-tree';
import { baseOptions } from '@/lib/layout.shared';

export function DocsLayoutShell({
  children,
  tree,
}: {
  children: React.ReactNode;
  tree: Root;
}) {
  return (
    <DocsLayout
      {...baseOptions()}
      tree={tree}
      themeSwitch={{ enabled: true }}
      githubUrl={'https://github.com/hypequery/hypequery'}
    >
      {children}
    </DocsLayout>
  );
}
