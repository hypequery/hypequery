'use client';

import type { ReactNode } from 'react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';

export default function PageWrapper({ children }: { children: ReactNode }) {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-bg pt-28 text-text">
        {children}
      </main>
      <Footer />
    </>
  );
}
