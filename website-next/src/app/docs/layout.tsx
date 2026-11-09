import { DocsLayoutShell } from '@/components/docs-layout-shell';
import type { Metadata } from 'next';
import { source } from '@/lib/meta';

// Docs titles end in "hypequery docs" so a page title read out of context ("Overview · MCP") still says what
// product and what kind of page it is. Applies to child segments only; /docs itself keeps the root template.
export const metadata: Metadata = {
  title: {
    default: 'hypequery documentation',
    template: '%s | hypequery docs',
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayoutShell tree={source.pageTree}>
      {children}
    </DocsLayoutShell>
  );
}
