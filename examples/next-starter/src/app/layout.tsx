import { QueryProvider } from '@/providers/query-provider';

export const metadata = {
  title: 'hypequery + Next.js Starter',
  description: 'A minimal starter for hypequery with Next.js',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
