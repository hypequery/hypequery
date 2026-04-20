import { DocsLayoutShell } from '@/components/docs-layout-shell';
import { source } from '@/lib/meta';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayoutShell tree={source.pageTree}>
      {children}
    </DocsLayoutShell>
  );
}
