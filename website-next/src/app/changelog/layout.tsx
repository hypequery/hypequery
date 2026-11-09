import type { ReactNode } from 'react';
import PageWrapper from '@/components/PageWrapper';

export default function ChangelogLayout({ children }: { children: ReactNode }) {
  return <PageWrapper>{children}</PageWrapper>;
}
