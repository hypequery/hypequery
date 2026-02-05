import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/meta';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout {...baseOptions()} tree={source.pageTree}>
      {children}
    </DocsLayout>
  );
}
