import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'In-app analytics agent with hypequery',
  description: 'A tenant-safe analytics agent in a Next.js app: per-session agent tokens, AI SDK chat, hypequery Cloud tools.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
